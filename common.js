class PeerManager {
  constructor() {
    this.peer = null; 
    this.conn = null;
    this.onPeerOpen = null; 
    this.onConnectionOpen = null;
    this.onData = null; 
    this.onClose = null; 
    this.onError = null;
    this.onStatusUpdate = null;
    this.isHost = false;
  }

  _options() {
    return {
      debug: 2,
      config: {
        iceServers: [
          // --- STUN Sunucuları ---
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' },
          
          // --- TURN SUNUCULARI ---
          // NOT: Eğer kendi Metered.ca hesabınızı açtıysanız, aşağıdaki 3 satırı 
          // kendi bilgilerinizle değiştirin. (En garantili yöntem budur).
          
          {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
          },
          {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject'
          },
          {
            urls: 'turn:openrelay.metered.ca:443?transport=tcp',
            username: 'openrelayproject',
            credential: 'openrelayproject'
          },
          // Alternatif Yedek TURN
          {
            urls: 'turn:turn.anyfirewall.com:443?transport=tcp',
            username: 'webrtc',
            credential: 'webrtc'
          }
        ],
        iceCandidatePoolSize: 10
      }
    };
  }

  initAsHost() {
    this.isHost = true;
    if (this.peer) { try { this.peer.destroy(); } catch (_) {} }
    
    this.peer = new Peer(null, this._options());

    this.peer.on('open', (id) => {
      this.onPeerOpen?.(id);
    });

    this.peer.on('connection', (conn) => {
      if (this.conn && this.conn.open) { try { conn.close(); } catch (_) {} return; }
      this.conn = conn; 
      this._setupConnection();
    });

    this.peer.on('error', (err) => {
      console.warn('Peer Hatası:', err);
      this.onError?.(err);
      this._handleReconnect();
    });

    this.peer.on('disconnected', () => {
      this.onStatusUpdate?.('Sunucu bağlantısı koptu, yeniden bağlanılıyor...');
      this._handleReconnect();
    });
  }

  initAsClient() {
    this.isHost = false;
    if (this.peer) { try { this.peer.destroy(); } catch (_) {} }
    
    this.peer = new Peer(null, this._options());

    this.peer.on('error', (err) => {
      console.warn('Peer Hatası:', err);
      this.onError?.(err);
      this._handleReconnect();
    });

    this.peer.on('disconnected', () => {
      this.onStatusUpdate?.('Sunucu bağlantısı koptu, yeniden bağlanılıyor...');
      this._handleReconnect();
    });
  }

  _handleReconnect() {
    if (!this.peer.destroyed) {
      setTimeout(() => {
        if (!this.peer.open) {
          try { this.peer.reconnect(); } catch (_) {
            if (this.isHost) this.initAsHost();
            else this.initAsClient();
          }
        }
      }, 3000);
    }
  }

  connectToRemote(remotePeerId) {
    if (!this.peer) this.initAsClient();
    if (!remotePeerId) return this.onError?.(new Error('Geçersiz Peer ID'));
    
    const connect = () => {
      if (this.conn && this.conn.open) return;
      
      this.onStatusUpdate?.('Eşleşme sağlanıyor, NAT aşılıyor...');
      
      this.conn = this.peer.connect(remotePeerId, { reliable: true });
      
      const pc = this.conn.peerConnection;
      if (pc) {
        pc.oniceconnectionstatechange = () => {
          if (pc.iceConnectionState === 'checking') {
            this.onStatusUpdate?.('Ağlar arası tünel açılıyor, lütfen bekleyin...');
          } else if (pc.iceConnectionState === 'failed') {
            this.onError?.({ type: 'ice-failed', message: 'Ağlar arası bağlantı kurulamadı (Güvenlik Duvarı / TURN engeli).' });
          }
        };
      }
      this._setupConnection();
    };

    if (this.peer.open) {
      connect();
    } else {
      this.peer.once('open', connect);
    }
  }

  _setupConnection() {
    const conn = this.conn;
    const handleOpen = () => this.onConnectionOpen?.();
    
    if (conn.open) handleOpen(); 
    else conn.on('open', handleOpen);
    
    conn.on('data', (data) => this.onData?.(data));
    conn.on('close', () => this.onClose?.());
    conn.on('error', (err) => this.onError?.(err));
  }

  send(data) {
    if (!this.connected) return false;
    try { 
      this.conn.send(data); 
      return true; 
    } catch (err) { 
      console.error('send error:', err); 
      return false; 
    }
  }

  get connected() { return !!(this.conn && this.conn.open); }
}

// --- Dosya transferi ve diğer yardımcı fonksiyonlar ---
const CHUNK_SIZE = 16 * 1024;

async function sendFile(peerManager, file, onProgress) {
  if (!peerManager.connected) throw new Error('Bağlantı yok');
  const dataChannel = peerManager.conn.dataChannel || peerManager.conn._dc;
  peerManager.send({ type: 'file-start', name: file.name, size: file.size, mimeType: file.type || 'application/octet-stream' });

  let offset = 0;
  while (offset < file.size) {
    if (dataChannel && dataChannel.bufferedAmount > 1024 * 1024) {
      await new Promise(r => setTimeout(r, 15)); continue;
    }
    const chunk = file.slice(offset, offset + CHUNK_SIZE);
    const buffer = await chunk.arrayBuffer();
    if (!peerManager.send(buffer)) throw new Error('Parça gönderilemedi');
    offset += buffer.byteLength;
    if (onProgress) onProgress(Math.min(offset / file.size, 1));
  }
  peerManager.send({ type: 'file-end' });
}

let incomingFile = null, incomingChunks = [], receivedBytes = 0;
let onIncomingProgress = null, onIncomingComplete = null;

function setupIncomingFileHandlers(progressCb, completeCb) {
  onIncomingProgress = progressCb; onIncomingComplete = completeCb;
}

function _isBuffer(data) { return data instanceof ArrayBuffer || ArrayBuffer.isView(data); }

function handleIncomingData(data) {
  if (data && typeof data === 'object' && !_isBuffer(data) && data.type === 'file-start') {
    incomingFile = data; incomingChunks = []; receivedBytes = 0; return;
  }
  if (_isBuffer(data)) {
    if (!incomingFile) return;
    incomingChunks.push(data); receivedBytes += data.byteLength;
    if (onIncomingProgress) onIncomingProgress(receivedBytes / incomingFile.size); return;
  }
  if (data && typeof data === 'object' && !_isBuffer(data) && data.type === 'file-end') {
    if (!incomingFile) return;
    const blob = new Blob(incomingChunks, { type: incomingFile.mimeType });
    if (onIncomingComplete) onIncomingComplete(blob, incomingFile);
    incomingFile = null; incomingChunks = []; receivedBytes = 0;
  }
}

function renderTextMessage(container, text, type) {
  const div = document.createElement('div'); div.className = `message ${type}`;
  div.textContent = text; container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function renderSystemMessage(container, text) {
  const div = document.createElement('div'); div.className = 'message system';
  div.textContent = text; container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function renderFileMessage(container, blobOrFile, fileInfo, type) {
  const div = document.createElement('div'); div.className = `message ${type} file-message`;
  const url = URL.createObjectURL(blobOrFile);

  if (fileInfo.mimeType.startsWith('image/')) {
    const img = document.createElement('img'); img.src = url; img.className = 'preview-image';
    img.alt = fileInfo.name; div.appendChild(img);
  } else if (fileInfo.mimeType.startsWith('video/')) {
    const video = document.createElement('video'); video.src = url; video.controls = true;
    video.className = 'preview-video'; div.appendChild(video);
  } else {
    const a = document.createElement('a'); a.href = url; a.download = fileInfo.name;
    a.textContent = `⬇️ İndir: ${fileInfo.name}`; a.className = 'download-link'; div.appendChild(a);
  }
  container.appendChild(div); container.scrollTop = container.scrollHeight;
}

function translatePeerError(err) {
  const map = {
    'peer-unavailable': 'Karşı cihaz bulunamadı. Bilgisayardaki sayfayı yenileyin.',
    'network': 'İnternet bağlantınız kesildi.',
    'server-error': 'Sinyal sunucusu yanıt vermiyor. Yeniden denenecek...',
    'socket-error': 'Sunucu bağlantısı koptu. Yeniden bağlanılıyor...',
    'browser-incompatible': 'Tarayıcınız WebRTC desteklemiyor.',
    'webrtc': 'WebRTC bağlantısı kurulamadı. Ağ kısıtlaması olabilir.',
    'ice-failed': 'Ağlar arası bağlantı kurulamadı. TURN sunucusu engellenmiş olabilir. Lütfen her iki cihazı da aynı Wi-Fi ağına bağlayarak test edin.'
  };
  return map[err.type] || err.message || 'Bilinmeyen hata';
}