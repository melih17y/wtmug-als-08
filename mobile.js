document.addEventListener('DOMContentLoaded', () => {
  const statusBadge = document.getElementById('status-badge');
  const scannerSection = document.getElementById('scanner-section');
  const chatSection = document.getElementById('chat-section');
  const video = document.getElementById('scanner-video');
  const canvas = document.getElementById('scanner-canvas');
  const manualIdInput = document.getElementById('manual-id');
  const manualConnectBtn = document.getElementById('manual-connect-btn');
  const messagesEl = document.getElementById('messages');
  const inputForm = document.getElementById('input-form');
  const messageInput = document.getElementById('message-input');
  const fileInput = document.getElementById('file-input');
  const progressContainer = document.getElementById('progress-container');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');

  const peerManager = new PeerManager();
  let scanning = true;
  let isSending = false;
  let mediaStream = null;

  // PeerJS istemcisini başlat (Sinyal sunucusuna bağlanır)
  peerManager.initAsClient();

  // --- KAMERA VE QR TARAMA MANTIĞI ---
  async function startScanner() {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      video.srcObject = mediaStream;
      await video.play();
      requestAnimationFrame(tick);
    } catch (err) {
      console.error('Kamera başlatılamadı:', err);
      statusBadge.textContent = '📷 Kamera Hatası';
      statusBadge.className = 'badge badge-error';
      renderSystemMessage(messagesEl, 'Kamera erişimi engellendi. Lütfen tarayıcıdan izin verin.');
    }
  }

  function stopScanner() {
    scanning = false;
    if (mediaStream) {
      mediaStream.getTracks().forEach(t => t.stop());
      mediaStream = null;
    }
  }

  function tick() {
    if (!scanning) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      // Performans için canvas boyutunu sabitliyoruz (Yüksek çözünürlük jsQR'ı yavaşlatır)
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      if (typeof jsQR !== 'undefined') {
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code && code.data) {
          stopScanner();
          connectToPeer(code.data.trim());
          return;
        }
      }
    }
    requestAnimationFrame(tick);
  }

  // --- BAĞLANTI MANTIĞI ---
  function connectToPeer(peerId) {
    if (!peerId) return;
    statusBadge.textContent = '🔗 Bağlanıyor...';
    statusBadge.className = 'badge badge-waiting';
    
    // Farklı ağlarda (Wi-Fi + 4G) bağlantı kurulurken NAT aşma mesajlarını ekrana bas
    peerManager.onStatusUpdate = (msg) => {
      statusBadge.textContent = `⏳ ${msg}`;
    };

    peerManager.connectToRemote(peerId);
  }

  manualConnectBtn.addEventListener('click', () => {
    const id = manualIdInput.value.trim();
    if (!id) return;
    stopScanner();
    connectToPeer(id);
  });

  // --- PEERJS OLAYLARI ---
  peerManager.onConnectionOpen = () => {
    statusBadge.textContent = '🟢 Bağlı';
    statusBadge.className = 'badge badge-connected';
    scannerSection.classList.add('hidden');
    chatSection.classList.remove('hidden');
    renderSystemMessage(messagesEl, '✅ P2P bağlantısı kuruldu. Uçtan uca şifreli.');
  };

  peerManager.onData = (data) => {
    if (typeof data === 'string') {
      renderTextMessage(messagesEl, data, 'received');
    } else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      handleIncomingData(data);
    } else if (data && typeof data === 'object') {
      if (data.type === 'file-start') { 
        handleIncomingData(data); 
        showProgress(); 
      }
      else if (data.type === 'file-end') { 
        handleIncomingData(data); 
      }
    }
  };

  setupIncomingFileHandlers(
    (p) => updateProgress(p),
    (blob, info) => { 
      hideProgress(); 
      renderFileMessage(messagesEl, blob, info, 'received'); 
    }
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
    console.error('PeerJS Hatası:', err);

    // Hata durumunda 4 saniye sonra kamerayı yeniden başlat (kullanıcıyı kilitleme)
    setTimeout(() => {
      if (!peerManager.connected) {
        statusBadge.textContent = 'QR Bekleniyor';
        statusBadge.className = 'badge badge-waiting';
        scannerSection.classList.remove('hidden');
        chatSection.classList.add('hidden');
        scanning = true;
        startScanner();
      }
    }, 4000);
  };

  // --- SOHBET VE DOSYA GÖNDERİMİ ---
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
    if (!file || isSending || !peerManager.connected) {
      return alert('Bağlantı yok veya işlem sürüyor.');
    }

    isSending = true; 
    showProgress();
    
    try {
      await sendFile(peerManager, file, (p) => updateProgress(p));
      hideProgress();
      renderFileMessage(messagesEl, file, { 
        name: file.name, 
        mimeType: file.type || 'application/octet-stream', 
        size: file.size 
      }, 'sent');
    } catch (err) {
      hideProgress(); 
      renderSystemMessage(messagesEl, '❌ Dosya gönderilemedi.');
    } finally { 
      isSending = false; 
      fileInput.value = ''; 
    }
  });

  // --- İLERLEME ÇUBUĞU YARDIMCILARI ---
  function showProgress() { 
    progressContainer.classList.remove('hidden'); 
    updateProgress(0); 
  }
  
  function hideProgress() { 
    progressContainer.classList.add('hidden'); 
    updateProgress(0); 
  }
  
  function updateProgress(p) {
    const percent = Math.round(p * 100);
    progressFill.style.width = `${percent}%`;
    progressText.textContent = `${percent}%`;
  }

  // Uygulamayı başlat
  startScanner();
});