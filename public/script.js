// LinkClick - Google Meet / Zoom Style WebRTC Mesh Client
// Includes Multi-User Mesh Video, In-Call Real-Time Chat Drawer, and Hand-Raising Feature

const socket = io();

// --- DOM Elements ---
// Header & Global
const connectionStatusPill = document.getElementById('connectionStatusPill');
const headerStatusText = document.getElementById('headerStatusText');
const liveClock = document.getElementById('liveClock');
const toastContainer = document.getElementById('toastContainer');

// Lobby Screen
const lobby = document.getElementById('lobby');
const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const roomInput = document.getElementById('roomInput');
const lobbyPreviewVideo = document.getElementById('lobbyPreviewVideo');
const lobbyCamOffOverlay = document.getElementById('lobbyCamOffOverlay');
const lobbyMicBtn = document.getElementById('lobbyMicBtn');
const lobbyCamBtn = document.getElementById('lobbyCamBtn');

// Active Call Screen
const callContainer = document.getElementById('callContainer');
const roomCodeDisplay = document.getElementById('roomCodeDisplay');
const copyCodeBtn = document.getElementById('copyCodeBtn');
const participantCountText = document.getElementById('participantCountText');
const videoGrid = document.getElementById('video-grid');
const localVideo = document.getElementById('localVideo');
const localCamOffOverlay = document.getElementById('localCamOffOverlay');
const localMicIndicator = document.getElementById('localMicIndicator');
const localHandBadge = document.getElementById('localHandBadge');

// In-Call Action Toolbar
const micToggleBtn = document.getElementById('micToggleBtn');
const camToggleBtn = document.getElementById('camToggleBtn');
const handToggleBtn = document.getElementById('handToggleBtn');
const screenShareBtn = document.getElementById('screenShareBtn');
const chatToggleBtn = document.getElementById('chatToggleBtn');
const chatUnreadBadge = document.getElementById('chatUnreadBadge');
const shareLinkBtn = document.getElementById('shareLinkBtn');
const leaveCallBtn = document.getElementById('leaveCallBtn');

// Chat Drawer Elements
const chatDrawer = document.getElementById('chatDrawer');
const chatCloseBtn = document.getElementById('chatCloseBtn');
const chatMessages = document.getElementById('chatMessages');
const chatEmptyState = document.getElementById('chatEmptyState');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');

// --- Application State ---
let localStream = null;
let currentRoomId = null;
let isAudioEnabled = true;
let isVideoEnabled = true;
let isScreenSharing = false;
let screenStream = null;

// Chat & Hand State
let isChatOpen = false;
let unreadMessageCount = 0;
let isLocalHandRaised = false;

// Map: socketId -> RTCPeerConnection
const peers = {};

// Map: socketId -> Array<RTCIceCandidateInit> (buffers candidates until remoteDescription is set)
const iceCandidateQueues = {};

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// Helper: Escape HTML to prevent XSS in chat
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// --- Live Clock Updater ---
function updateLiveClock() {
  if (!liveClock) return;
  const now = new Date();
  liveClock.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
setInterval(updateLiveClock, 1000);
updateLiveClock();

// --- Toast Notification System ---
function showToast(message, type = 'info') {
  if (!toastContainer) return;
  const toast = document.createElement('div');
  toast.className = `px-4 py-3 rounded-xl backdrop-blur-xl border text-xs font-semibold shadow-2xl flex items-center gap-2 pointer-events-auto transform transition-all duration-300`;

  if (type === 'success') {
    toast.className += ' bg-emerald-950/90 border-emerald-500/30 text-emerald-300';
    toast.innerHTML = `<svg class="w-4 h-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg><span>${message}</span>`;
  } else if (type === 'error') {
    toast.className += ' bg-rose-950/90 border-rose-500/30 text-rose-300';
    toast.innerHTML = `<svg class="w-4 h-4 text-rose-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg><span>${message}</span>`;
  } else {
    toast.className += ' bg-slate-900/90 border-primary-500/30 text-sky-200';
    toast.innerHTML = `<svg class="w-4 h-4 text-primary-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg><span>${message}</span>`;
  }

  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-8px) scale(0.95)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// --- Dynamic Responsive Grid Layout ---
function updateGridLayout() {
  const count = 1 + Object.keys(peers).length;
  if (participantCountText) {
    participantCountText.textContent = `${count} Active Participant${count > 1 ? 's' : ''}`;
  }

  videoGrid.className = 'w-full h-full max-h-[72vh] grid gap-3 sm:gap-4 items-center justify-center transition-all duration-300';

  if (count === 1) {
    videoGrid.classList.add('grid-cols-1', 'max-w-4xl');
  } else if (count === 2) {
    videoGrid.classList.add('grid-cols-1', 'md:grid-cols-2', 'max-w-6xl');
  } else if (count === 3) {
    videoGrid.classList.add('grid-cols-1', 'sm:grid-cols-2', 'lg:grid-cols-3', 'max-w-7xl');
  } else {
    // 4 participants (2x2 grid)
    videoGrid.classList.add('grid-cols-1', 'sm:grid-cols-2', 'max-w-6xl');
  }
}

// --- Initialize Local Media Stream ---
async function initLocalStream() {
  if (localStream) return localStream;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true
    });
    localStream = stream;

    // Attach to lobby preview and in-call video
    if (lobbyPreviewVideo) lobbyPreviewVideo.srcObject = stream;
    if (localVideo) localVideo.srcObject = stream;

    return stream;
  } catch (error) {
    console.warn('High-res media error, attempting fallback:', error);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStream = stream;
      if (lobbyPreviewVideo) lobbyPreviewVideo.srcObject = stream;
      if (localVideo) localVideo.srcObject = stream;
      return stream;
    } catch (fallbackError) {
      console.error('Media devices unavailable:', fallbackError);
      showToast('Camera and Microphone permissions not granted.', 'error');
      localStream = new MediaStream();
      return localStream;
    }
  }
}

// --- Generate 6-Character Unique Room Code ---
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// --- Join Room Flow ---
async function joinRoom(rawRoomId) {
  if (!rawRoomId) {
    showToast('Please enter a room code.', 'error');
    return;
  }

  const roomId = rawRoomId.trim().toUpperCase();
  currentRoomId = roomId;

  await initLocalStream();
  socket.emit('join-room', roomId);
}

// --- Lobby Event Listeners ---
if (createBtn) {
  createBtn.onclick = () => {
    const code = generateRoomCode();
    joinRoom(code);
  };
}

if (joinBtn) {
  joinBtn.onclick = () => {
    const code = roomInput.value.trim();
    if (code) {
      joinRoom(code);
    } else {
      showToast('Please enter a valid meeting code.', 'error');
    }
  };
}

if (roomInput) {
  roomInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const code = roomInput.value.trim();
      if (code) joinRoom(code);
    }
  });

  roomInput.addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  });
}

// --- Socket.io Handlers ---

socket.on('connect', () => {
  if (headerStatusText) headerStatusText.textContent = 'WebRTC Engine Connected';
});

// When current user joins room
socket.on('room-joined', async ({ roomId, existingUsers }) => {
  console.log(`[Room Joined] Room: ${roomId}, existing peers:`, existingUsers);
  showCallUI(roomId);
  showToast(`Joined meeting ${roomId}`, 'success');

  // Initiate peer connection & offer to every user ALREADY in the room
  for (const targetSocketId of existingUsers) {
    createPeerConnection(targetSocketId, true);
  }
  updateGridLayout();
});

// When a NEW user joins after you
socket.on('user-joined', ({ socketId }) => {
  console.log('[User Joined Room]:', socketId);
  showToast(`Participant joined the meeting!`, 'info');
  // Prepare receiver peer connection for incoming offer
  createPeerConnection(socketId, false);
  updateGridLayout();
});

socket.on('full', (roomId) => {
  showToast(`Room ${roomId} is full (max 4 participants in Mesh mode).`, 'error');
});

// Relay: Received SDP Offer
socket.on('offer', async ({ sender, offer }) => {
  console.log('[WebRTC] Received offer from:', sender);
  try {
    let pc = peers[sender];
    if (!pc) {
      pc = createPeerConnection(sender, false);
    }

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    console.log('[WebRTC] Remote description (offer) set for:', sender);

    // Flush buffered ICE candidates
    await drainIceCandidates(sender, pc);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.emit('answer', { target: sender, answer });
    console.log('[WebRTC] Emitted answer to:', sender);
  } catch (err) {
    console.error('[WebRTC] Error handling offer from', sender, err);
  }
});

// Relay: Received SDP Answer
socket.on('answer', async ({ sender, answer }) => {
  console.log('[WebRTC] Received answer from:', sender);
  try {
    const pc = peers[sender];
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      console.log('[WebRTC] Remote description (answer) set for:', sender);
      await drainIceCandidates(sender, pc);
    }
  } catch (err) {
    console.error('[WebRTC] Error setting remote description for answer:', err);
  }
});

// Relay: Received ICE Candidate
socket.on('ice-candidate', async ({ sender, candidate }) => {
  try {
    if (!candidate) return;

    const rtcCandidate = new RTCIceCandidate(candidate);
    const pc = peers[sender];

    if (pc && pc.remoteDescription && pc.remoteDescription.type) {
      await pc.addIceCandidate(rtcCandidate);
    } else {
      if (!iceCandidateQueues[sender]) {
        iceCandidateQueues[sender] = [];
      }
      iceCandidateQueues[sender].push(rtcCandidate);
    }
  } catch (err) {
    console.error('[WebRTC] Error adding ICE candidate from', sender, err);
  }
});

// Peer left room
socket.on('user-left', ({ socketId }) => {
  console.log('[User Left]:', socketId);
  showToast(`A participant left the meeting.`, 'info');

  if (peers[socketId]) {
    peers[socketId].close();
    delete peers[socketId];
  }
  delete iceCandidateQueues[socketId];

  const videoElem = document.getElementById(`container-${socketId}`);
  if (videoElem) {
    videoElem.remove();
  }
  updateGridLayout();
});

// --- Real-Time Chat Socket Handler ---
socket.on('receive-message', ({ senderId, senderName, message, timestamp }) => {
  // Remove empty state placeholder on first message
  if (chatEmptyState) {
    chatEmptyState.classList.add('hidden');
  }

  const isSelf = senderId === socket.id;
  const messageNode = document.createElement('div');
  messageNode.className = isSelf
    ? 'flex flex-col items-end max-w-[85%] self-end'
    : 'flex flex-col items-start max-w-[85%] self-start';

  const safeName = escapeHtml(isSelf ? 'You' : (senderName || `User (${senderId.substring(0, 5)})`));
  const safeText = escapeHtml(message);
  const nameColor = isSelf ? 'text-slate-300 font-semibold' : 'text-primary-400 font-semibold';

  messageNode.innerHTML = `
    <div class="flex items-center gap-1.5 mb-1 text-[10px] text-slate-400">
      <span class="${nameColor}">${safeName}</span>
      <span>${timestamp}</span>
    </div>
    <div class="px-3.5 py-2 rounded-2xl text-xs sm:text-sm leading-relaxed ${isSelf ? 'chat-bubble-self' : 'chat-bubble-peer'} break-words shadow-sm">
      ${safeText}
    </div>
  `;

  chatMessages.appendChild(messageNode);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  // If chat drawer is closed and message is from peer, increment unread badge and show toast
  if (!isSelf && !isChatOpen) {
    unreadMessageCount++;
    if (chatUnreadBadge) {
      chatUnreadBadge.textContent = unreadMessageCount > 9 ? '9+' : unreadMessageCount;
      chatUnreadBadge.classList.remove('hidden');
    }
    showToast(`${safeName}: ${safeText}`, 'info');
  }
});

// --- Hand-Raising Socket Handler ---
socket.on('hand-toggled', ({ socketId, isHandRaised }) => {
  console.log(`[Peer Hand Toggled] ${socketId}: ${isHandRaised}`);
  const handBadge = document.getElementById(`hand-badge-${socketId}`);
  if (handBadge) {
    if (isHandRaised) {
      handBadge.classList.remove('hidden');
      showToast(`Participant (${socketId.substring(0, 5)}) raised their hand ✋`, 'info');
    } else {
      handBadge.classList.add('hidden');
    }
  }
});

// --- Drain Buffered ICE Candidates ---
async function drainIceCandidates(socketId, pc) {
  const queue = iceCandidateQueues[socketId];
  if (queue && queue.length > 0) {
    while (queue.length > 0) {
      const cand = queue.shift();
      try {
        await pc.addIceCandidate(cand);
      } catch (err) {
        console.error('[WebRTC] Error adding buffered candidate:', err);
      }
    }
  }
}

// --- Create Peer Connection ---
function createPeerConnection(targetSocketId, isInitiator) {
  if (peers[targetSocketId]) {
    return peers[targetSocketId];
  }

  const pc = new RTCPeerConnection(rtcConfig);
  peers[targetSocketId] = pc;
  iceCandidateQueues[targetSocketId] = iceCandidateQueues[targetSocketId] || [];

  // Add local stream tracks to this peer connection
  if (localStream) {
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
  }

  // Handle remote track addition
  pc.ontrack = (event) => {
    console.log('[WebRTC] ontrack from:', targetSocketId, event.track.kind);
    if (event.streams && event.streams[0]) {
      addRemoteVideo(targetSocketId, event.streams[0]);
    }
  };

  // Send ICE candidates to the targeted peer
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', {
        target: targetSocketId,
        candidate: event.candidate
      });
    }
  };

  // Monitor connection states
  pc.onconnectionstatechange = () => {
    console.log(`[WebRTC] Connection state with ${targetSocketId}: ${pc.connectionState}`);
    const container = document.getElementById(`container-${targetSocketId}`);
    if (container) {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        container.classList.add('opacity-60', 'grayscale');
      } else if (pc.connectionState === 'connected') {
        container.classList.remove('opacity-60', 'grayscale');
      }
    }
  };

  // If initiator, explicitly create and emit the SDP offer
  if (isInitiator) {
    initiateOffer(targetSocketId, pc);
  }

  return pc;
}

// --- Explicit Offer Generator ---
async function initiateOffer(targetSocketId, pc) {
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { target: targetSocketId, offer: pc.localDescription });
    console.log('[WebRTC] Offer created and sent to:', targetSocketId);
  } catch (err) {
    console.error('[WebRTC] Failed to create offer for:', targetSocketId, err);
  }
}

// --- Remote Video Tile Renderer ---
function addRemoteVideo(socketId, stream) {
  let container = document.getElementById(`container-${socketId}`);
  if (!container) {
    container = document.createElement('div');
    container.className = 'video-tile relative w-full h-full max-h-full rounded-2xl overflow-hidden bg-dark-950 border border-white/10 shadow-2xl flex items-center justify-center aspect-video sm:aspect-auto';
    container.id = `container-${socketId}`;

    // Remote video (NOT mirrored)
    const video = document.createElement('video');
    video.id = `video-${socketId}`;
    video.autoplay = true;
    video.playsInline = true;
    video.className = 'w-full h-full object-cover';

    // Raised Hand Badge Overlay (Top Left)
    const handBadge = document.createElement('div');
    handBadge.id = `hand-badge-${socketId}`;
    handBadge.className = 'absolute top-3 left-3 z-30 flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-400 text-dark-950 font-bold text-xs shadow-lg shadow-amber-400/30 animate-bounce hidden';
    handBadge.innerHTML = `<span>✋</span><span>Hand Raised</span>`;

    // Bottom-Left Label Badge Overlay
    const label = document.createElement('div');
    label.className = 'absolute bottom-3 left-3 z-20 flex items-center gap-1.5 px-3 py-1 rounded-full bg-dark-900/80 backdrop-blur-md border border-white/10 text-xs font-semibold text-white shadow-md';
    label.innerHTML = `
      <span class="w-2 h-2 rounded-full bg-primary-400"></span>
      <span>Participant (${socketId.substring(0, 5)})</span>
    `;

    container.appendChild(video);
    container.appendChild(handBadge);
    container.appendChild(label);
    videoGrid.appendChild(container);
    updateGridLayout();
  }

  const videoElem = document.getElementById(`video-${socketId}`);
  if (videoElem && videoElem.srcObject !== stream) {
    videoElem.srcObject = stream;
  }
}

// --- Chat Drawer Toggling ---
function toggleChat(forceState) {
  isChatOpen = typeof forceState === 'boolean' ? forceState : !isChatOpen;

  if (isChatOpen) {
    chatDrawer.classList.remove('translate-x-full');
    chatToggleBtn.classList.add('bg-primary-500', 'text-white', 'shadow-primary-500/30');
    chatToggleBtn.classList.remove('bg-slate-800');
    
    // Clear unread badge
    unreadMessageCount = 0;
    if (chatUnreadBadge) {
      chatUnreadBadge.classList.add('hidden');
      chatUnreadBadge.textContent = '0';
    }
    setTimeout(() => chatInput.focus(), 150);
  } else {
    chatDrawer.classList.add('translate-x-full');
    chatToggleBtn.classList.remove('bg-primary-500', 'shadow-primary-500/30');
    chatToggleBtn.classList.add('bg-slate-800');
  }
}

// --- Send Chat Message Handler ---
if (chatForm) {
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text || !currentRoomId) return;

    socket.emit('send-message', {
      roomId: currentRoomId,
      senderName: 'You',
      message: text
    });

    chatInput.value = '';
  });
}

// --- Hand-Raising Toggle Handler ---
function toggleHand() {
  if (!currentRoomId) return;
  isLocalHandRaised = !isLocalHandRaised;

  if (isLocalHandRaised) {
    handToggleBtn.className = 'w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-amber-400 hover:bg-amber-500 text-dark-950 flex items-center justify-center transition-all duration-200 shadow-lg shadow-amber-400/40';
    if (localHandBadge) localHandBadge.classList.remove('hidden');
    showToast('You raised your hand ✋', 'info');
  } else {
    handToggleBtn.className = 'w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-slate-800 hover:bg-slate-700 text-white flex items-center justify-center transition-all duration-200 shadow-sm';
    if (localHandBadge) localHandBadge.classList.add('hidden');
    showToast('You lowered your hand', 'info');
  }

  socket.emit('toggle-hand', {
    roomId: currentRoomId,
    isHandRaised: isLocalHandRaised
  });
}

// --- UI Navigation ---
function showCallUI(roomId) {
  lobby.classList.add('hidden');
  callContainer.classList.remove('hidden');
  if (roomCodeDisplay) {
    roomCodeDisplay.innerText = roomId;
  }

  // Update URL query string
  const newUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
  window.history.pushState({ path: newUrl }, '', newUrl);
  updateGridLayout();
}

function leaveCallUI() {
  // Close and cleanup all peer connections
  Object.keys(peers).forEach((socketId) => {
    if (peers[socketId]) {
      peers[socketId].close();
      delete peers[socketId];
    }
    delete iceCandidateQueues[socketId];

    const container = document.getElementById(`container-${socketId}`);
    if (container) container.remove();
  });

  if (isScreenSharing) {
    stopScreenSharing();
  }

  // Reset Hand & Chat states
  if (isLocalHandRaised) {
    toggleHand();
  }
  toggleChat(false);

  // Notify server
  socket.emit('leave-room');
  currentRoomId = null;

  callContainer.classList.add('hidden');
  lobby.classList.remove('hidden');

  // Clean URL
  const cleanUrl = `${window.location.origin}${window.location.pathname}`;
  window.history.pushState({ path: cleanUrl }, '', cleanUrl);

  showToast('You have left the meeting.', 'info');
}

// --- Media Control Handlers ---

function toggleAudio() {
  if (!localStream) return;
  const audioTracks = localStream.getAudioTracks();
  if (audioTracks.length === 0) return;

  isAudioEnabled = !isAudioEnabled;
  audioTracks.forEach((t) => (t.enabled = isAudioEnabled));

  updateMicButtons();
}

function updateMicButtons() {
  const micSvgActive = `
    <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
      <line x1="12" y1="19" x2="12" y2="23"></line>
      <line x1="8" y1="23" x2="16" y2="23"></line>
    </svg>`;

  const micSvgMuted = `
    <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="1" y1="1" x2="23" y2="23"></line>
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
      <line x1="12" y1="19" x2="12" y2="23"></line>
      <line x1="8" y1="23" x2="16" y2="23"></line>
    </svg>`;

  if (isAudioEnabled) {
    if (micToggleBtn) {
      micToggleBtn.className = 'w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-slate-800 hover:bg-slate-700 text-white flex items-center justify-center transition-all duration-200 shadow-sm';
      micToggleBtn.innerHTML = micSvgActive;
    }
    if (lobbyMicBtn) {
      lobbyMicBtn.className = 'w-11 h-11 rounded-full bg-slate-800 hover:bg-slate-700 border border-white/10 text-slate-200 flex items-center justify-center transition-all duration-200';
      lobbyMicBtn.innerHTML = micSvgActive;
    }
    if (localMicIndicator) localMicIndicator.textContent = '';
    showToast('Microphone unmuted', 'info');
  } else {
    if (micToggleBtn) {
      micToggleBtn.className = 'w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center transition-all duration-200 shadow-lg shadow-rose-600/30';
      micToggleBtn.innerHTML = micSvgMuted;
    }
    if (lobbyMicBtn) {
      lobbyMicBtn.className = 'w-11 h-11 rounded-full bg-rose-600 border border-rose-500 text-white flex items-center justify-center transition-all duration-200';
      lobbyMicBtn.innerHTML = micSvgMuted;
    }
    if (localMicIndicator) localMicIndicator.textContent = '(Muted)';
    showToast('Microphone muted', 'info');
  }
}

function toggleVideo() {
  if (!localStream) return;
  const videoTracks = localStream.getVideoTracks();
  if (videoTracks.length === 0) return;

  isVideoEnabled = !isVideoEnabled;
  videoTracks.forEach((t) => (t.enabled = isVideoEnabled));

  updateCamButtons();
}

function updateCamButtons() {
  const camSvgActive = `
    <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="23 7 16 12 23 17 23 7"></polygon>
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
    </svg>`;

  const camSvgOff = `
    <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="1" y1="1" x2="23" y2="23"></line>
      <path d="M21 21l-3.34-3.34A2 2 0 0 1 16 18H5a2 2 0 0 1-2-2V8a2 2 0 0 1 1.66-1.97L1.34 2.66"></path>
      <path d="M23 7l-7 5 3.5 2.5"></path>
    </svg>`;

  if (isVideoEnabled) {
    if (camToggleBtn) {
      camToggleBtn.className = 'w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-slate-800 hover:bg-slate-700 text-white flex items-center justify-center transition-all duration-200 shadow-sm';
      camToggleBtn.innerHTML = camSvgActive;
    }
    if (lobbyCamBtn) {
      lobbyCamBtn.className = 'w-11 h-11 rounded-full bg-slate-800 hover:bg-slate-700 border border-white/10 text-slate-200 flex items-center justify-center transition-all duration-200';
      lobbyCamBtn.innerHTML = camSvgActive;
    }
    if (localCamOffOverlay) localCamOffOverlay.classList.add('hidden');
    if (lobbyCamOffOverlay) lobbyCamOffOverlay.classList.add('hidden');
    showToast('Camera enabled', 'info');
  } else {
    if (camToggleBtn) {
      camToggleBtn.className = 'w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center transition-all duration-200 shadow-lg shadow-rose-600/30';
      camToggleBtn.innerHTML = camSvgOff;
    }
    if (lobbyCamBtn) {
      lobbyCamBtn.className = 'w-11 h-11 rounded-full bg-rose-600 border border-rose-500 text-white flex items-center justify-center transition-all duration-200';
      lobbyCamBtn.innerHTML = camSvgOff;
    }
    if (localCamOffOverlay) localCamOffOverlay.classList.remove('hidden');
    if (lobbyCamOffOverlay) lobbyCamOffOverlay.classList.remove('hidden');
    showToast('Camera turned off', 'info');
  }
}

// --- Screen Sharing Support across Mesh ---
async function toggleScreenShare() {
  if (isScreenSharing) {
    stopScreenSharing();
    return;
  }

  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const screenTrack = screenStream.getVideoTracks()[0];

    // In Mesh topology, replace the video sender track across ALL active peer connections!
    Object.values(peers).forEach((pc) => {
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
      if (sender) {
        sender.replaceTrack(screenTrack);
      }
    });

    localVideo.srcObject = screenStream;
    localVideo.classList.remove('local-mirror'); // Do not mirror shared screen
    isScreenSharing = true;

    // Highlight screen share button
    screenShareBtn.className = 'w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-primary-500 hover:bg-primary-600 text-white flex items-center justify-center transition-all duration-200 shadow-lg shadow-primary-500/30';
    showToast('You are sharing your screen', 'success');

    screenTrack.onended = () => {
      stopScreenSharing();
    };
  } catch (err) {
    console.warn('Screen share canceled or error:', err);
  }
}

async function stopScreenSharing() {
  if (!isScreenSharing) return;

  if (screenStream) {
    screenStream.getTracks().forEach((track) => track.stop());
    screenStream = null;
  }

  isScreenSharing = false;
  screenShareBtn.className = 'w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-slate-800 hover:bg-slate-700 text-white flex items-center justify-center transition-all duration-200 shadow-sm';

  // Restore camera track to all peers
  if (localStream) {
    const cameraTrack = localStream.getVideoTracks()[0];
    Object.values(peers).forEach((pc) => {
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
      if (sender && cameraTrack) {
        sender.replaceTrack(cameraTrack);
      }
    });
    localVideo.srcObject = localStream;
    localVideo.classList.add('local-mirror');
  }

  showToast('Screen sharing stopped', 'info');
}

// --- Copy Meeting Link / Code Helper ---
function copyRoomInvite() {
  if (!currentRoomId) return;
  const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${currentRoomId}`;
  navigator.clipboard.writeText(inviteUrl)
    .then(() => {
      showToast(`Invite link copied to clipboard! (Room: ${currentRoomId})`, 'success');
    })
    .catch(() => {
      navigator.clipboard.writeText(currentRoomId);
      showToast(`Meeting code ${currentRoomId} copied!`, 'success');
    });
}

// Attach Event Listeners
if (copyCodeBtn) copyCodeBtn.addEventListener('click', copyRoomInvite);
if (shareLinkBtn) shareLinkBtn.addEventListener('click', copyRoomInvite);
if (micToggleBtn) micToggleBtn.addEventListener('click', toggleAudio);
if (camToggleBtn) camToggleBtn.addEventListener('click', toggleVideo);
if (handToggleBtn) handToggleBtn.addEventListener('click', toggleHand);
if (screenShareBtn) screenShareBtn.addEventListener('click', toggleScreenShare);
if (chatToggleBtn) chatToggleBtn.addEventListener('click', () => toggleChat());
if (chatCloseBtn) chatCloseBtn.addEventListener('click', () => toggleChat(false));
if (leaveCallBtn) leaveCallBtn.addEventListener('click', leaveCallUI);

if (lobbyMicBtn) lobbyMicBtn.addEventListener('click', toggleAudio);
if (lobbyCamBtn) lobbyCamBtn.addEventListener('click', toggleVideo);

// Initialize on page load
window.addEventListener('DOMContentLoaded', async () => {
  // Start pre-call self preview
  await initLocalStream();

  // Auto-fill room code if present in URL (?room=ABCDEF)
  const params = new URLSearchParams(window.location.search);
  const roomParam = params.get('room');
  if (roomParam && roomInput) {
    roomInput.value = roomParam.trim().toUpperCase().slice(0, 8);
    showToast(`Found meeting code ${roomInput.value}. Click Join to enter!`, 'info');
  }
});