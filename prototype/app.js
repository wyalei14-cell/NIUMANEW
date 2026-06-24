const I18N = {
  zh: {
    wallet: '连接钱包 / Connect Wallet',
    connected: '已连接: 0x12...9AcF'
  },
  en: {
    wallet: 'Connect Wallet / 连接钱包',
    connected: 'Connected: 0x12...9AcF'
  }
};

const walletStates = ['idle', 'connecting', 'signing', 'broadcast', 'success', 'error'];
let walletStateIndex = 0;
let lang = 'zh';

function $(id) { return document.getElementById(id); }

function showToast(text) {
  const toast = $('toast');
  if (!toast) return;
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function syncWalletState() {
  const list = document.querySelectorAll('#walletStateList li');
  list.forEach((el) => el.classList.toggle('active', el.dataset.state === walletStates[walletStateIndex]));
}

function bindWalletFlow() {
  const walletBtn = $('walletBtn');
  const walletDialog = $('walletDialog');
  const closeDialog = $('closeDialog');
  const nextState = $('nextState');
  const confirmConnect = $('confirmConnect');

  if (!walletBtn || !walletDialog) return;

  walletBtn.addEventListener('click', () => {
    walletDialog.showModal();
    syncWalletState();
  });

  closeDialog?.addEventListener('click', () => walletDialog.close());

  nextState?.addEventListener('click', () => {
    walletStateIndex = (walletStateIndex + 1) % walletStates.length;
    syncWalletState();
  });

  confirmConnect?.addEventListener('click', () => {
    walletStateIndex = 1;
    syncWalletState();
    showToast('请在钱包中确认连接 / Confirm connection in wallet');
    setTimeout(() => {
      walletStateIndex = 2; syncWalletState();
      showToast('请签名 / Please sign the request');
    }, 1200);
    setTimeout(() => {
      walletStateIndex = 3; syncWalletState();
      showToast('交易广播中... / Transaction broadcasting...');
    }, 2400);
    setTimeout(() => {
      walletStateIndex = 4; syncWalletState();
      walletBtn.textContent = I18N[lang].connected;
      showToast('交易已确认 / Transaction confirmed');
    }, 3800);
  });
}

function bindLanguage() {
  const toggle = $('langToggle');
  const walletBtn = $('walletBtn');
  if (!toggle || !walletBtn) return;
  toggle.addEventListener('click', () => {
    lang = lang === 'zh' ? 'en' : 'zh';
    toggle.textContent = lang === 'zh' ? 'EN' : '中文';
    if (!walletBtn.textContent.includes('0x12')) {
      walletBtn.textContent = I18N[lang].wallet;
    } else {
      walletBtn.textContent = I18N[lang].connected;
    }
    showToast(lang === 'zh' ? '已切换中文界面' : 'Switched to English UI');
  });
}

function bindPublishForm() {
  const form = $('publishForm');
  if (!form) return;

  const stepEls = [...document.querySelectorAll('[data-step]')];
  let step = 1;

  function syncStep() {
    stepEls.forEach((el) => {
      el.style.display = Number(el.dataset.step) === step ? 'block' : 'none';
    });
    showToast(`当前步骤 Step ${step}/4`);
  }

  document.querySelectorAll('[data-next]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (step < 4) step += 1;
      syncStep();
    });
  });
  document.querySelectorAll('[data-prev]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (step > 1) step -= 1;
      syncStep();
    });
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    showToast('已提交链上发布请求，请在钱包确认。');
  });

  syncStep();
}

bindWalletFlow();
bindLanguage();
bindPublishForm();
