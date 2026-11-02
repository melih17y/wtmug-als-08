document.addEventListener('DOMContentLoaded', () => {
  const statusBadge = document.getElementById('status-badge');
  const qrSection = document.getElementById('qr-section');
  const chatSection = document.getElementById('chat-section');
  const qrContainer = document.getElementById('qr-container');
  const peerIdDisplay = document.getElementById('peer-id-display');
  const messagesEl = document.getElementById('messages');
  const inputForm = document.getElementById('input-form');
  const messageInput = document.getElementById('message-input');
  const fileInput = document.getElementById('file-input');
  const progressContainer = document.getElementById('progress-container');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');

  const peerManager = new PeerManager();
  let isSending = false;

  peerManager.onPeerOpen = (id) => {
    peerIdDisplay.textContent = `Peer ID: ${id}`;
    qrContainer.innerHTML = '';
    new QRCode(qrContainer, { text: id, width: 256, height: 256, correctLevel: QRCode.CorrectLevel.H });
    statusBadge.textContent = 'Bağlantı Bekleniyor';
    statusBadge.className = 'badge badge-waiting';
  };

  peerManager.onConnectionOpen = () => {
    statusBadge.textContent = '🟢 Bağlı';
    statusBadge.className = 'badge badge-connected';
    qrSection.classList.add('hidden');
    chatSection.classList.remove('hidden');
    renderSystemMessage(messagesEl, '✅ P2P bağlantısı kuruldu. Uçtan uca şifreli.');
  };

  peerManager.onData = (data) => {
    if (typeof data === 'string') renderTextMessage(messagesEl, data, 'received');
    else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) handleIncomingData(data);
    else if (data && typeof data === 'object') {
      if (data.type === 'file-start') { handleIncomingData(data); showProgress(); }
      else if (data.type === 'file-end') handleIncomingData(data);
    }
  };

  setupIncomingFileHandlers(
    (p) => updateProgress(p),
    (blob, info) => { hideProgress(); renderFileMessage(messagesEl, blob, info, 'received'); }
  );

  peerManager.onClose = () => {
    statusBadge.textContent = '🔴 Bağlantı Kesildi';
    statusBadge.className = 'badge badge-error';
    renderSystemMessage(messagesEl, '⚠️ Karşı taraf bağlantıyı kapattı.');
  };

  peerManager.onError = (err) => {
    const msg = translatePeerError(err);
    statusBadge.textContent = '⚠️ Bağlantı Hatası';
    statusBadge.className = 'badge badge-error';
    renderSystemMessage(messagesEl, `❌ ${msg}`);
  };

  peerManager.initAsHost();

  inputForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text || !peerManager.connected) return;
    peerManager.send(text);
    renderTextMessage(messagesEl, text, 'sent');
    messageInput.value = '';
  });

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || isSending || !peerManager.connected) return alert('Bağlantı yok veya işlem sürüyor.');
    isSending = true; showProgress();
    try {
      await sendFile(peerManager, file, (p) => updateProgress(p));
      hideProgress();
      renderFileMessage(messagesEl, file, { name: file.name, mimeType: file.type || 'application/octet-stream', size: file.size }, 'sent');
    } catch (err) {
      hideProgress(); renderSystemMessage(messagesEl, '❌ Dosya gönderilemedi.');
    } finally { isSending = false; fileInput.value = ''; }
  });

  function showProgress() { progressContainer.classList.remove('hidden'); updateProgress(0); }
  function hideProgress() { progressContainer.classList.add('hidden'); updateProgress(0); }
  function updateProgress(p) {
    const percent = Math.round(p * 100);
    progressFill.style.width = `${percent}%`;
    progressText.textContent = `${percent}%`;
  }
});