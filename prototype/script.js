const walletBtn = document.getElementById('walletBtn');
const walletDialog = document.getElementById('walletDialog');
const closeDialog = document.getElementById('closeDialog');
const nextState = document.getElementById('nextState');

const states = ['idle', 'connecting', 'signing', 'broadcast', 'success', 'error'];
let idx = 0;

function syncState() {
  const items = [...document.querySelectorAll('#walletStateList li')];
  items.forEach((item) => {
    item.classList.toggle('active', item.dataset.state === states[idx]);
  });
}

walletBtn.addEventListener('click', () => {
  walletDialog.showModal();
  syncState();
});

nextState.addEventListener('click', () => {
  idx = (idx + 1) % states.length;
  syncState();
});

closeDialog.addEventListener('click', () => {
  walletDialog.close();
});
