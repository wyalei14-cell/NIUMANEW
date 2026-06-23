// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface ICitizenRegistryForMarketplace {
    function isCitizen(address owner) external view returns (bool);
    function citizenOf(address owner) external view returns (uint256);
}

/**
 * @title ServiceMarketplace
 * @notice Citizens can post services, accept them via escrow, complete/deliver,
 *         and resolve disputes. Integrates with ReputationSystem for bonus points.
 */
contract ServiceMarketplace is Ownable {
    enum ServiceStatus {
        Open,
        Accepted,
        Completed,
        Canceled,
        Disputed
    }

    enum DisputeResolution {
        ReleaseToProvider,
        RefundToClient
    }

    struct Service {
        uint256 id;
        address provider;
        uint256 providerCitizenId;
        string title;
        string description;
        string category;
        uint256 price;            // in wei
        uint256 maxDuration;      // seconds
        ServiceStatus status;
        address client;
        uint256 clientCitizenId;
        uint256 escrowAmount;
        uint256 acceptedAt;
        uint256 completedAt;
        uint256 createdAt;
        uint256[] reviewIds;
    }

    struct Review {
        uint256 id;
        uint256 serviceId;
        address reviewer;
        uint8 rating;             // 1-5
        string comment;
        uint256 createdAt;
    }

    ICitizenRegistryForMarketplace public immutable citizenRegistry;
    address public reputationSystem;

    uint256 public nextServiceId = 1;
    uint256 public nextReviewId = 1;
    uint256 public platformFeeBps = 250; // 2.5% default, in basis points

    mapping(uint256 => Service) private services;
    mapping(uint256 => Review) private reviews;
    mapping(uint256 => mapping(address => bool)) private hasReviewed;

    // Aggregate stats
    uint256 public totalServicesPosted;
    uint256 public totalServicesCompleted;
    uint256 public totalVolume; // total wei transacted

    event ServicePosted(uint256 indexed serviceId, uint256 indexed providerCitizenId, address indexed provider, string title, string category, uint256 price);
    event ServiceAccepted(uint256 indexed serviceId, address indexed client, uint256 clientCitizenId, uint256 escrowAmount);
    event ServiceCompleted(uint256 indexed serviceId);
    event PaymentReleased(uint256 indexed serviceId, address indexed provider, uint256 payout, uint256 fee);
    event ServiceDisputed(uint256 indexed serviceId, address indexed disputer);
    event ServiceResolved(uint256 indexed serviceId, bool releasedToProvider, uint256 payout, uint256 refund);
    event ServiceCanceled(uint256 indexed serviceId, address indexed canceller);
    event ReviewPosted(uint256 indexed reviewId, uint256 indexed serviceId, uint8 rating, address reviewer);
    event PlatformFeeUpdated(uint256 oldBps, uint256 newBps);

    error OnlyCitizen();
    error ServiceMissing();
    error InvalidStatus();
    error NotServiceOwner();
    error NotClient();
    error InsufficientPayment();
    error AlreadyReviewed();
    error InvalidRating();
    error DisputeNotOpen();
    error NotDisputer();
    error WrongValue();

    constructor(address citizenRegistry_, address reputationSystem_, address initialOwner)
        Ownable(initialOwner)
    {
        citizenRegistry = ICitizenRegistryForMarketplace(citizenRegistry_);
        reputationSystem = reputationSystem_;
    }

    modifier onlyCitizen() {
        if (!citizenRegistry.isCitizen(msg.sender)) revert OnlyCitizen();
        _;
    }

    // --- Core marketplace ---

    function postService(
        string calldata title,
        string calldata description,
        string calldata category,
        uint256 price,
        uint256 maxDuration
    ) external onlyCitizen returns (uint256 serviceId) {
        serviceId = nextServiceId++;
        uint256 citizenId = citizenRegistry.citizenOf(msg.sender);
        services[serviceId] = Service({
            id: serviceId,
            provider: msg.sender,
            providerCitizenId: citizenId,
            title: title,
            description: description,
            category: category,
            price: price,
            maxDuration: maxDuration,
            status: ServiceStatus.Open,
            client: address(0),
            clientCitizenId: 0,
            escrowAmount: 0,
            acceptedAt: 0,
            completedAt: 0,
            createdAt: block.timestamp,
            reviewIds: new uint256[](0)
        });
        totalServicesPosted += 1;
        emit ServicePosted(serviceId, citizenId, msg.sender, title, category, price);
    }

    function acceptService(uint256 serviceId) external payable onlyCitizen {
        Service storage svc = _requireService(serviceId);
        if (svc.status != ServiceStatus.Open) revert InvalidStatus();
        if (msg.sender == svc.provider) revert WrongValue();
        if (msg.value < svc.price) revert InsufficientPayment();

        uint256 citizenId = citizenRegistry.citizenOf(msg.sender);
        svc.status = ServiceStatus.Accepted;
        svc.client = msg.sender;
        svc.clientCitizenId = citizenId;
        svc.escrowAmount = msg.value;
        svc.acceptedAt = block.timestamp;

        emit ServiceAccepted(serviceId, msg.sender, citizenId, msg.value);
    }

    function completeService(uint256 serviceId) external {
        Service storage svc = _requireService(serviceId);
        if (svc.status != ServiceStatus.Accepted) revert InvalidStatus();
        if (msg.sender != svc.provider && msg.sender != svc.client) revert WrongValue();

        svc.status = ServiceStatus.Completed;
        svc.completedAt = block.timestamp;

        // Release payment: provider gets (amount - fee), owner collects fee
        uint256 fee = (svc.escrowAmount * platformFeeBps) / 10000;
        uint256 payout = svc.escrowAmount - fee;

        (bool ok,) = svc.provider.call{value: payout}("");
        require(ok, "Transfer failed");
        if (fee > 0) {
            (bool ok2,) = owner().call{value: fee}("");
            require(ok2, "Fee transfer failed");
        }

        totalServicesCompleted += 1;
        totalVolume += svc.escrowAmount;

        emit ServiceCompleted(serviceId);
        emit PaymentReleased(serviceId, svc.provider, payout, fee);
    }

    // --- Disputes ---

    function disputeService(uint256 serviceId) external {
        Service storage svc = _requireService(serviceId);
        if (svc.status != ServiceStatus.Accepted) revert InvalidStatus();
        if (msg.sender != svc.provider && msg.sender != svc.client) revert WrongValue();

        svc.status = ServiceStatus.Disputed;
        emit ServiceDisputed(serviceId, msg.sender);
    }

    function resolveDispute(uint256 serviceId, DisputeResolution resolution) external onlyOwner {
        Service storage svc = _requireService(serviceId);
        if (svc.status != ServiceStatus.Disputed) revert DisputeNotOpen();

        uint256 fee = (svc.escrowAmount * platformFeeBps) / 10000;
        uint256 netAmount = svc.escrowAmount - fee;
        uint256 payout = 0;
        uint256 refund = 0;

        if (resolution == DisputeResolution.ReleaseToProvider) {
            payout = netAmount;
            (bool ok,) = svc.provider.call{value: payout}("");
            require(ok, "Transfer failed");
            if (fee > 0) {
                (bool ok2,) = owner().call{value: fee}("");
                require(ok2, "Fee transfer failed");
            }
            svc.status = ServiceStatus.Completed;
            svc.completedAt = block.timestamp;
            totalServicesCompleted += 1;
        } else {
            refund = svc.escrowAmount;
            (bool ok3,) = svc.client.call{value: refund}("");
            require(ok3, "Transfer failed");
            svc.status = ServiceStatus.Canceled;
        }

        totalVolume += (resolution == DisputeResolution.ReleaseToProvider) ? svc.escrowAmount : 0;

        emit ServiceResolved(serviceId, resolution == DisputeResolution.ReleaseToProvider, payout, refund);
    }

    // --- Cancel (only before acceptance or by provider when open) ---

    function cancelService(uint256 serviceId) external {
        Service storage svc = _requireService(serviceId);
        if (svc.status == ServiceStatus.Accepted) {
            // Refund escrow to client
            if (msg.sender != svc.client) revert WrongValue();
            (bool ok,) = svc.client.call{value: svc.escrowAmount}("");
            require(ok, "Transfer failed");
        } else if (svc.status == ServiceStatus.Open) {
            if (msg.sender != svc.provider) revert NotServiceOwner();
        } else {
            revert InvalidStatus();
        }
        svc.status = ServiceStatus.Canceled;
        emit ServiceCanceled(serviceId, msg.sender);
    }

    // --- Reviews ---

    function postReview(uint256 serviceId, uint8 rating, string calldata comment) external onlyCitizen {
        Service storage svc = _requireService(serviceId);
        if (svc.status != ServiceStatus.Completed) revert InvalidStatus();
        if (msg.sender != svc.provider && msg.sender != svc.client) revert WrongValue();
        if (hasReviewed[serviceId][msg.sender]) revert AlreadyReviewed();
        if (rating < 1 || rating > 5) revert InvalidRating();

        uint256 reviewId = nextReviewId++;
        reviews[reviewId] = Review({
            id: reviewId,
            serviceId: serviceId,
            reviewer: msg.sender,
            rating: rating,
            comment: comment,
            createdAt: block.timestamp
        });
        hasReviewed[serviceId][msg.sender] = true;
        svc.reviewIds.push(reviewId);

        emit ReviewPosted(reviewId, serviceId, rating, msg.sender);
    }

    // --- Admin ---

    function setPlatformFeeBps(uint256 bps) external onlyOwner {
        if (bps > 1000) revert WrongValue(); // max 10%
        uint256 oldBps = platformFeeBps;
        platformFeeBps = bps;
        emit PlatformFeeUpdated(oldBps, bps);
    }

    function setReputationSystem(address addr) external onlyOwner {
        reputationSystem = addr;
    }

    function withdrawStuckFunds() external onlyOwner {
        (bool ok,) = owner().call{value: address(this).balance}("");
        require(ok, "Transfer failed");
    }

    // --- Views ---

    function getService(uint256 serviceId) external view returns (Service memory) {
        return _requireService(serviceId);
    }

    function getReview(uint256 reviewId) external view returns (Review memory) {
        Review storage r = reviews[reviewId];
        if (r.id == 0) revert ServiceMissing();
        return r;
    }

    function getMarketplaceStats() external view returns (
        uint256 posted,
        uint256 completed,
        uint256 volume,
        uint256 feeBps
    ) {
        return (totalServicesPosted, totalServicesCompleted, totalVolume, platformFeeBps);
    }

    // --- Internal ---

    function _requireService(uint256 serviceId) internal view returns (Service storage) {
        Service storage svc = services[serviceId];
        if (svc.id == 0) revert ServiceMissing();
        return svc;
    }

    receive() external payable {}
}
