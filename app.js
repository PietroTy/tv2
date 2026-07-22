/* ============================================================
   TV2 — Client Application
   Televisão sincronizada com chat ao vivo
   ============================================================ */

/* ---------- State ---------- */
let channels = [];
let currentChannel = 0;
let player = null;
let playerReady = false;
let started = true;
let currentVideoIdx = 0;
let currentPartIdx = 0;
let serverTimeOffset = 0;
let socket = null;
let currentViewerCount = 0;
let userVolume = 50;
let fadeInterval = null;
let lastMessageUser = null;
let staticAudioTimeout = null;
let staticVisualTimeout = null;
let currentVideoTitle = '';
let currentNextVideoTitle = '';
let nowPlayingInterval = null;
let lastChScrollTime = 0;
let autoplayCheckTimeout = null;
let userInteracted = false;
let isPowerOn = false;
let powerOnTimeout = null;
let errorTimeout = null;


/* ---------- DOM Refs ---------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  channelBar: null,
  screen: null,
  playerWrap: null,
  staticOverlay: null,
  noiseCanvas: null,
  staticText: null,
  channelHud: null,
  nowPlaying: null,
  npTitle: null,
  transitionFlash: null,
  chatMessages: null,
  chatInput: null,
  chatChannelName: null,
  viewerCount: null,
  loginBtn: null,
  userInfo: null,
  userAvatar: null,
  userName: null,
};

/* ---------- Noise Canvas ---------- */
let noiseCtx = null;
let noiseRunning = false;
let noiseAnimId = null;

function initNoiseCanvas() {
  const canvas = dom.noiseCanvas;
  if (!canvas) return;
  canvas.width = 256;
  canvas.height = 144;
  noiseCtx = canvas.getContext('2d', { willReadFrequently: true });
}

function startNoise() {
  if (noiseRunning) return;
  noiseRunning = true;
  drawNoise();
}

function stopNoise() {
  noiseRunning = false;
  if (noiseAnimId) {
    cancelAnimationFrame(noiseAnimId);
    noiseAnimId = null;
  }
}

function drawNoise() {
  if (!noiseRunning || !noiseCtx) return;
  const w = 256;
  const h = 144;
  const imgData = noiseCtx.createImageData(w, h);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const v = Math.random() * 255;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  noiseCtx.putImageData(imgData, 0, 0);
  noiseAnimId = setTimeout(() => requestAnimationFrame(drawNoise), 1000 / 15);
}

/* ---------- Time Sync ---------- */
function getServerTime() {
  return Date.now() + serverTimeOffset;
}

async function syncTime() {
  try {
    const t0 = Date.now();
    const res = await fetch('/api/time');
    const data = await res.json();
    const t1 = Date.now();
    const rtt = (t1 - t0) / 2;
    serverTimeOffset = data.timestamp - t1 + rtt;
  } catch (err) {
    console.warn('TV2: falha ao sincronizar relógio', err);
    serverTimeOffset = 0;
  }
}

/* ---------- Playback State Calculation ---------- */
function getItemDuration(item) {
  return item.dur;
}

function getNextItemTitle(ch, videoIdx, partIdx) {
  const videos = ch.videos;
  if (!videos || videos.length === 0) return '—';
  
  const currentItem = videos[videoIdx];
  if (currentItem && currentItem.type === 'episode' && currentItem.parts && currentItem.parts.length > 0) {
    if (partIdx + 1 < currentItem.parts.length) {
      const nextPart = currentItem.parts[partIdx + 1];
      return currentItem.title + ' — ' + nextPart.title;
    }
  }
  
  const nextVideoIdx = (videoIdx + 1) % videos.length;
  const nextItem = videos[nextVideoIdx];
  if (nextItem) {
    if (nextItem.type === 'episode' && nextItem.parts && nextItem.parts.length > 0) {
      const firstPart = nextItem.parts[0];
      return nextItem.title + ' — ' + firstPart.title;
    }
    return nextItem.title || '—';
  }
  return '—';
}

function getPlaybackState(channelIdx) {
  const ch = channels[channelIdx];
  if (!ch || !ch.videos || ch.videos.length === 0) return null;

  const videos = ch.videos;
  let totalDuration = 0;
  for (let i = 0; i < videos.length; i++) {
    totalDuration += getItemDuration(videos[i]);
  }

  if (totalDuration <= 0) return null;

  // Meia-noite UTC do dia atual baseado no relógio sincronizado
  const now = new Date(getServerTime());
  const startOfDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  
  let position = Math.floor((getServerTime() - startOfDay) / 1000) % totalDuration;
  if (position < 0) position += totalDuration;

  for (let videoIdx = 0; videoIdx < videos.length; videoIdx++) {
    const item = videos[videoIdx];
    const itemDur = getItemDuration(item);

    if (position < itemDur) {
      if (item.type === 'episode' && item.parts && item.parts.length > 0) {
        let partOffset = position;
        for (let partIdx = 0; partIdx < item.parts.length; partIdx++) {
          const part = item.parts[partIdx];
          if (partOffset < part.dur) {
            return {
              videoIdx: videoIdx,
              partIdx: partIdx,
              videoId: part.id,
              title: item.title + ' — ' + part.title,
              nextTitle: getNextItemTitle(ch, videoIdx, partIdx),
              startSec: partOffset,
            };
          }
          partOffset -= part.dur;
        }
        const lastPart = item.parts[item.parts.length - 1];
        return {
          videoIdx: videoIdx,
          partIdx: item.parts.length - 1,
          videoId: lastPart.id,
          title: item.title + ' — ' + lastPart.title,
          nextTitle: getNextItemTitle(ch, videoIdx, item.parts.length - 1),
          startSec: 0,
        };
      } else {
        return {
          videoIdx: videoIdx,
          partIdx: 0,
          videoId: item.id,
          title: item.title || '',
          nextTitle: getNextItemTitle(ch, videoIdx, 0),
          startSec: position,
        };
      }
    }

    position -= itemDur;
  }

  return null;
}

async function getSyncPlaybackState(channelIdx) {
  try {
    const res = await fetch('/api/playback/' + channelIdx);
    if (res.ok) {
      const state = await res.json();
      if (state && state.videoId !== undefined) {
        return state;
      }
    }
  } catch (err) {
    console.warn('TV2: falha ao buscar playback do servidor', err);
  }
  return getPlaybackState(channelIdx);
}

/* ---------- YouTube Player ---------- */
function loadYouTubeAPI() {
  if (window.YT && window.YT.Player) {
    onYouTubeIframeAPIReady();
    return;
  }
  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(tag);
}

window.onYouTubeIframeAPIReady = function () {
  player = new YT.Player('yt-player', {
    width: '100%',
    height: '100%',
    playerVars: {
      autoplay: 1,
      controls: 0,
      disablekb: 1,
      fs: 0,
      modestbranding: 1,
      rel: 0,
      iv_load_policy: 3,
      playsinline: 1,
      cc_load_policy: 0,
    },
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange,
      onError: onPlayerError,
    },
  });
};

function onPlayerReady() {
  playerReady = true;
  if (started) {
    startPlayback();
  }
}

function startStaticToVideoTransition() {
  clearTimeout(staticAudioTimeout);
  clearTimeout(staticVisualTimeout);

  if (!isPowerOn) return;

  // Se o chiado não estiver ativo (transição normal), ignora o delay
  if (dom.staticOverlay && !dom.staticOverlay.classList.contains('show')) {
    if (player && player.setVolume) player.setVolume(userVolume);
    return;
  }

  // Regra geral: som do chiado sai ANTES do visual
  staticAudioTimeout = setTimeout(() => {
    if (!isPowerOn) return;
    fadeOutNoiseSound(1200);
    // Volume do YouTube entra com um leve atraso após o chiado começar a sumir
    setTimeout(() => {
      if (!isPowerOn) return;
      fadeInYouTubeVolume(userVolume, 1500);
    }, 800);
  }, 3000);

  staticVisualTimeout = setTimeout(() => {
    if (!isPowerOn) return;
    hideStaticOverlayOnly();
  }, 5500);
}

function onPlayerStateChange(event) {
  const state = event.data;

  if (state === YT.PlayerState.ENDED) {
    if (dom.playerWrap) dom.playerWrap.style.opacity = '0';
    advanceVideo();
  }

  if (state === YT.PlayerState.PAUSED && started && isPowerOn) {
    clearTimeout(staticAudioTimeout);
    clearTimeout(staticVisualTimeout);

    setTimeout(() => {
      if (player && player.getPlayerState && player.getPlayerState() === YT.PlayerState.PAUSED && isPowerOn) {
        player.playVideo();
      }
    }, 300);
  }

  if (state === YT.PlayerState.PLAYING) {
    if (dom.playerWrap) dom.playerWrap.style.opacity = '1';
    if (autoplayCheckTimeout) clearTimeout(autoplayCheckTimeout);
    try {
      const vd = player.getVideoData();
      if (vd && vd.video_id) applyVideoRatio(vd.video_id);
    } catch(_) {}
    try {
      player.unloadModule('captions');
      player.unloadModule('cc');
      player.setOption('captions', 'track', {});
      player.setOption('cc', 'track', {});
    } catch(_) {}

    if (isPowerOn) {
      startStaticToVideoTransition();
    }
  }
}

function onPlayerError() {
  const ch = channels[currentChannel];
  if (ch && ch.videos && ch.videos[currentVideoIdx]) {
    const video = ch.videos[currentVideoIdx];
    
    getSyncPlaybackState(currentChannel).then(state => {
      if (state && state.videoId) {
        let partDur = video.dur;
        if (video.type === 'episode' && video.parts && video.parts[currentPartIdx]) {
          partDur = video.parts[currentPartIdx].dur;
        }
        
        const remainingSec = partDur - state.startSec;
        const remainingMs = Math.max(0, remainingSec * 1000);
        
        console.warn('TV2: Vídeo falhou (bloqueado/restrito). Aguardando ' + remainingSec + 's sincronizado com o servidor...');
        
        if (isPowerOn) {
          showStaticOverlay('SINAL FRACO');
        }
        
        clearTimeout(errorTimeout);
        errorTimeout = setTimeout(() => {
          advanceVideo();
        }, remainingMs + 1000); // Tenta o próximo com 1s de margem
      } else {
        setTimeout(() => advanceVideo(), 3000);
      }
    });
  } else {
    setTimeout(() => advanceVideo(), 3000);
  }
}

/* ---------- Video Loading ---------- */
function loadVideo(state) {
  if (!state || !player || !playerReady) return;

  currentVideoIdx = state.videoIdx;
  currentPartIdx = state.partIdx;

  try {
    if (!isPowerOn) {
      player.mute();
      player.setVolume(0);
    } else {
      player.unMute();
      if (dom.staticOverlay && dom.staticOverlay.classList.contains('show')) {
        player.setVolume(0);
      } else {
        player.setVolume(userVolume);
      }
    }
  } catch(e) {}
  player.loadVideoById({ videoId: state.videoId, startSeconds: state.startSec });

  applyVideoRatio(state.videoId);
  startNowPlayingLoop(state.title, state.nextTitle);
}

/* Detecta o aspect-ratio real do vídeo via oEmbed e aplica ao CSS (Desativado: proporção fixa) */
async function applyVideoRatio(videoId) {
  return;
}

function setScreenRatio(w, h) {
  const root = document.documentElement.style;
  root.setProperty('--screen-ratio', `${w} / ${h}`);
  root.setProperty('--ratio-w', w);
  root.setProperty('--ratio-h', h);
}

async function advanceVideo() {
  if (isPowerOn) {
    showStaticOverlay('SINTONIZANDO...');
  }
  const state = await getSyncPlaybackState(currentChannel);
  
  setTimeout(() => {
    if (state) {
      loadVideo(state);
    } else {
      if (isPowerOn) {
        hideStaticOverlay();
      }
    }
  }, 600);
}

/* ---------- Channel Switching ---------- */
function switchChannel(idx) {
  if (idx < 0 || idx >= channels.length) return;
  currentChannel = idx;

  const chKnob = document.getElementById('ch-knob');
  if (chKnob) {
    updateKnobImage(chKnob, idx * 45);
  }

  const btns = $$('#tv-channel-buttons .tv-ch-push');
  btns.forEach((b, i) => b.classList.toggle('active', i === idx));

  const ch = channels[idx];
  const label = ch.label || ch.name || 'Canal ' + (idx + 1);

  if (dom.chatChannelName) {
    dom.chatChannelName.textContent = 'CH ' + (idx + 1);
  }

  if (isPowerOn) {
    showStaticOverlay(label.toUpperCase());
    triggerFlash();
    showChannelHUD(label);

    if (socket) {
      socket.emit('join-channel', { channel: currentChannel });
    }

    clearChatMessages();

    setTimeout(async () => {
      if (!isPowerOn) return;
      const state = await getSyncPlaybackState(currentChannel);
      if (state && isPowerOn) {
        loadVideo(state);
      } else {
        if (isPowerOn) {
          hideStaticOverlay();
        }
      }
    }, 800);
  }
}

function showStaticOverlay(text) {
  // Limpar timeouts anteriores para evitar conflitos de transição
  clearTimeout(staticAudioTimeout);
  clearTimeout(staticVisualTimeout);
  clearInterval(fadeInterval); // Limpa fade anterior do volume

  if (dom.nowPlaying) {
    dom.nowPlaying.classList.remove('show');
  }

  if (dom.staticOverlay) {
    dom.staticOverlay.classList.add('show');
  }
  
  if (dom.staticText && text !== undefined) {
    dom.staticText.textContent = text;
  }
  startNoise();
  startNoiseSound();
  
  // Garantir volume 0 no YouTube durante o chiado
  if (player && playerReady && player.setVolume) {
    try {
      player.setVolume(0);
    } catch(e) {}
  }
}

function setTVVolume(vol) {
  if (isPowerOn) {
    if (player && playerReady && player.setVolume) {
      player.setVolume(vol);
      player.unMute();
    }
  }
}

function hideStaticOverlayOnly() {
  if (dom.staticOverlay) {
    dom.staticOverlay.classList.remove('show');
  }
  stopNoise();
}

function hideStaticOverlay() {
  clearTimeout(staticAudioTimeout);
  clearTimeout(staticVisualTimeout);
  
  hideStaticOverlayOnly();
  stopNoiseSound();
  
  if (player && playerReady && player.setVolume) {
    try {
      if (isPowerOn) {
        player.setVolume(userVolume);
      } else {
        player.setVolume(0);
        player.mute();
      }
    } catch(e) {}
  }
}

/* ---------- Transition Flash ---------- */
function triggerFlash() {
  const el = dom.transitionFlash;
  if (!el) return;
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 250);
}

/* ---------- On-Screen Display (OSD) ---------- */
let hudTimeout = null;
function showChannelHUD(name) {
  const osd = $('#osd-display');
  const osdCh = $('#osd-channel');
  if (!osd || !osdCh) return;

  const displayNum = String(currentChannel + 1).padStart(2, '0');
  if (name.toUpperCase().startsWith('CH ')) {
    osdCh.textContent = name.toUpperCase();
  } else {
    osdCh.textContent = 'CH ' + displayNum + ' ' + name.toUpperCase();
  }

  osd.classList.add('show');
  clearTimeout(hudTimeout);
  hudTimeout = setTimeout(() => {
    osd.classList.remove('show');
  }, 3500);
}

/* ---------- Now Playing ---------- */
let npSeqTimeout = null;
let currentNextTitle = null;
let isShowingNoAr = false;

function chDisplayName() {
  const ch = channels[currentChannel];
  return (ch && ch.name) ? ch.name : `CH ${String(currentChannel + 1).padStart(2, '0')}`;
}

function epNameOnly(title) {
  if (!title) return '—';
  const sep = title.indexOf(' — ');
  return sep !== -1 ? title.slice(sep + 3) : title;
}

function updateNowPlaying(title, nextTitle) {
  clearTimeout(npSeqTimeout);

  if (!dom.nowPlaying || !dom.npTitle || !dom.npLabel || !dom.npScrollWrapper) return;

  currentNextTitle = nextTitle;
  isShowingNoAr = true;

  dom.npLabel.textContent = `▶ VOCÊ ESTÁ ASSISTINDO no canal ${chDisplayName()}`;
  dom.npTitle.textContent = title || '—';

  dom.npScrollWrapper.style.animation = 'none';
  void dom.npScrollWrapper.offsetWidth;
  dom.npScrollWrapper.style.animation = 'marquee-wrapper 18s linear forwards';

  dom.nowPlaying.classList.add('show');
}

function startNowPlayingLoop(title, nextTitle) {
  clearInterval(nowPlayingInterval);
  currentVideoTitle = title;
  currentNextVideoTitle = nextTitle;

  updateNowPlaying(title, nextTitle);

  nowPlayingInterval = setInterval(() => {
    updateNowPlaying(currentVideoTitle, currentNextVideoTitle);
  }, 300000); // 5 minutos
}

function handleNowPlayingAnimationEnd() {
  if (!dom.nowPlaying || !dom.npScrollWrapper) return;

  if (isShowingNoAr) {
    // Terminou o "NO AR". Esconde o banner.
    dom.nowPlaying.classList.remove('show');
    isShowingNoAr = false;

    // Se houver próxima atração, agenda a transição para o "A SEGUIR"
    if (currentNextTitle) {
      npSeqTimeout = setTimeout(() => {
        dom.npLabel.textContent = `▶ A SEGUIR no canal ${chDisplayName()}`;
        dom.npTitle.textContent = epNameOnly(currentNextTitle);
        currentNextTitle = null;

        // Reiniciar animação do marquee no wrapper para o próximo título
        dom.npScrollWrapper.style.animation = 'none';
        void dom.npScrollWrapper.offsetWidth;
        dom.npScrollWrapper.style.animation = 'marquee-wrapper 18s linear forwards';

        dom.nowPlaying.classList.add('show');
      }, 600); // 600ms de intervalo com a tela limpa
    }
  } else {
    // Terminou o "A SEGUIR". Esconde o banner.
    dom.nowPlaying.classList.remove('show');
  }
}

// (setupClickToStart removido para autoplay imediato)

async function startPlayback() {
  if (!playerReady) return;
  const state = await getSyncPlaybackState(currentChannel);
  if (state) {
    loadVideo(state);
  }
  if (socket) {
    socket.emit('join-channel', { channel: currentChannel });
  }
}

function renderChannelBar() {
  const bar = dom.channelBar;
  if (!bar) return;
  bar.innerHTML = '';

  channels.forEach((ch, idx) => {
    const btn = document.createElement('button');
    btn.className = 'tv-ch-push' + (idx === 0 ? ' active' : '');
    const displayNum = String(idx + 1).padStart(2, '0');
    btn.textContent = 'CH ' + displayNum;
    btn.title = ch.name || 'Canal ' + (idx + 1);
    btn.addEventListener('click', () => switchChannel(idx));
    bar.appendChild(btn);
  });
}

/* ---------- Socket.IO Chat ---------- */
function connectSocket() {
  if (typeof io === 'undefined') {
    console.info('TV2: Socket.IO não disponível (modo estático).');
    return;
  }
  socket = io({ transports: ['websocket', 'polling'] });

  socket.on('connect', () => {
    if (started) {
      socket.emit('join-channel', { channel: currentChannel });
    }
  });

  socket.on('chat-message', (msg) => {
    appendChatMessage(msg);
  });

  socket.on('viewer-count', (data) => {
    const count = typeof data === 'object' ? data.count : data;
    currentViewerCount = count;
    if (dom.viewerCount) {
      dom.viewerCount.textContent = String(count).padStart(2, '0');
    }
  });

  socket.on('disconnect', () => {
    console.warn('TV2: desconectado do servidor');
  });
}

function sendChatMessage() {
  const input = dom.chatInput;
  if (!input) return;
  const text = input.value.trim();
  if (!text || !socket) return;

  socket.emit('chat-message', {
    text: text,
    channel: currentChannel,
  });

  input.value = '';
  input.focus();
}

function appendChatMessage(msg) {
  const container = dom.chatMessages;
  if (!container) return;

  const div = document.createElement('div');
  div.className = 'chat-msg';

  if (msg.system) {
    div.classList.add('system');
    div.innerHTML = '<span class="chat-text">' + escapeHtml(msg.text) + '</span>';
    container.appendChild(div);
    lastMessageUser = null; // Reset do agrupamento após mensagem do sistema
    scrollChat();
    return;
  }

  const userName = msg.user || 'Anônimo';
  const isConsecutive = lastMessageUser === userName;
  const time = msg.timestamp ? new Date(msg.timestamp) : new Date();
  const timeStr = String(time.getHours()).padStart(2, '0') + ':' + String(time.getMinutes()).padStart(2, '0');

  if (isConsecutive) {
    div.classList.add('consecutive');
    div.innerHTML =
      '<div class="chat-avatar-spacer"></div>' +
      '<div class="chat-msg-body">' +
      '<span class="chat-text">' + escapeHtml(msg.text) + '</span>' +
      '</div>' +
      '<span class="chat-time">' + timeStr + '</span>';
  } else {
    const avatarHtml = msg.avatar
      ? '<img class="chat-avatar" src="' + escapeHtml(msg.avatar) + '" alt="" onerror="this.style.display=\'none\'">'
      : '<div class="chat-avatar-letter" style="background:' + userColor(userName) + '">' + userName.charAt(0).toUpperCase() + '</div>';

    div.innerHTML =
      avatarHtml +
      '<div class="chat-msg-body">' +
      '<span class="chat-username">' + escapeHtml(userName) + '</span>' +
      '<span class="chat-text">' + escapeHtml(msg.text) + '</span>' +
      '</div>' +
      '<span class="chat-time">' + timeStr + '</span>';

    lastMessageUser = userName;
  }

  container.appendChild(div);

  while (container.children.length > 200) {
    container.removeChild(container.firstChild);
  }

  scrollChat();
}

function clearChatMessages() {
  if (dom.chatMessages) {
    dom.chatMessages.innerHTML = '';
  }
  lastMessageUser = null;
}

function scrollChat() {
  const c = dom.chatMessages;
  if (!c) return;
  requestAnimationFrame(() => {
    c.scrollTop = c.scrollHeight;
  });
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

const userColorsMap = {};
function userColor(name) {
  if (!userColorsMap[name]) {
    const hue = Math.floor(Math.random() * 360);
    userColorsMap[name] = 'hsl(' + hue + ', 75%, 55%)';
  }
  return userColorsMap[name];
}

/* ---------- Auth ---------- */
let isLoggedIn = false;

function loginGoogle() {
  window.location.href = '/auth/google';
}

function logoutUser() {
  fetch('/auth/logout', { credentials: 'same-origin' })
    .then(() => {
      window.location.reload();
    })
    .catch(() => {
      window.location.reload();
    });
}

function handleAuthClick() {
  if (isLoggedIn) {
    const confirmed = window.confirm('Tem certeza que deseja sair da conta Google?');
    if (!confirmed) return;
    logoutUser();
  } else {
    loginGoogle();
  }
}

async function checkAuth() {
  try {
    const res = await fetch('/auth/me', { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Não autenticado');
    const data = await res.json();

    if (data && data.user) {
      isLoggedIn = true;
      if (dom.loginBtn) {
        dom.loginBtn.style.display = 'none';
      }
      if (dom.userInfo) {
        dom.userInfo.style.display = 'flex';
      }
      if (dom.userAvatar && data.user.avatar) {
        dom.userAvatar.src = data.user.avatar;
      }
      if (dom.userName) {
        dom.userName.textContent = data.user.displayName;
      }
    }
  } catch {
    isLoggedIn = false;
    if (dom.loginBtn) {
      dom.loginBtn.style.display = 'inline-block';
    }
    if (dom.userInfo) {
      dom.userInfo.style.display = 'none';
    }
  }
}

/* ---------- Chat Input Handlers ---------- */
function setupChatInput() {
  const input = dom.chatInput;
  if (!input) return;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendChatMessage();
    }
  });
}

/* ---------- Watchdog ---------- */
function startWatchdog() {
  setInterval(() => {
    if (!started || !playerReady || !player || !isPowerOn) return;

    const state = getPlaybackState(currentChannel);
    if (!state) return;

    if (state.videoIdx !== currentVideoIdx || state.partIdx !== currentPartIdx) {
      advanceVideo();
      return;
    }

    try {
      const playerState = player.getPlayerState();
      if (playerState === YT.PlayerState.PLAYING) {
        const currentTime = player.getCurrentTime();
        const drift = Math.abs(currentTime - state.startSec);
        if (drift > 6) {
          player.seekTo(state.startSec, true);
        }
      }
    } catch {
      /* player may not be ready */
    }
  }, 5000);
  setInterval(() => {
    if (!started || !playerReady || !player || !isPowerOn) return;
    try {
      if (player.getPlayerState() === YT.PlayerState.PLAYING) {
        const cur = player.getCurrentTime();
        const dur = player.getDuration();
        // Hide video visually in the last 15 seconds to avoid youtube end screens
        if (dur > 0 && (dur - cur) <= 15) {
          if (dom.playerWrap && dom.playerWrap.style.opacity !== '0') {
            dom.playerWrap.style.opacity = '0';
          }
        }
      }
    } catch {}
  }, 1000);
}

/* ---------- Load Channels ---------- */
async function loadChannels() {
  try {
    const res = await fetch('./data/channels.json');
    const data = await res.json();
    channels = Array.isArray(data) ? data : data.channels || [];
  } catch (err) {
    console.error('TV2: falha ao carregar canais', err);
    channels = [];
  }
}

/* ---------- Cache DOM ---------- */
function cacheDom() {
  dom.channelBar = $('#tv-channel-buttons');
  dom.screen = $('#screen');
  dom.playerWrap = $('#player-wrap');
  dom.staticOverlay = $('#static-overlay');
  dom.noiseCanvas = $('#noise-canvas');
  dom.staticText = $('#static-text');
  dom.channelHud = $('#osd-display');
  dom.nowPlaying = $('#now-playing');
  dom.npScrollWrapper = $('#np-scroll-wrapper');
  dom.npLabel = $('#np-label');
  dom.npTitle = $('#np-title');
  dom.transitionFlash = $('#transition-flash');
  dom.chatMessages = $('#chat-messages');
  dom.chatInput = $('#chat-input');
  dom.chatChannelName = $('#chat-channel-name');
  dom.viewerCount = $('#chat-viewer-count-number');
  dom.loginBtn = $('#google-login-btn');
  dom.userInfo = $('#chat-user-info');
  dom.userAvatar = $('#chat-user-avatar');
  dom.userName = $('#chat-user-name');
}

function toggleFullscreen() {
  if (!isPowerOn) return;
  const screenEl = $('#screen');
  if (!screenEl) return;

  if (!document.fullscreenElement && 
      !document.webkitFullscreenElement && 
      !document.mozFullScreenElement && 
      !document.msFullscreenElement) {
    if (screenEl.requestFullscreen) {
      screenEl.requestFullscreen();
    } else if (screenEl.webkitRequestFullscreen) {
      screenEl.webkitRequestFullscreen();
    } else if (screenEl.mozRequestFullScreen) {
      screenEl.mozRequestFullScreen();
    } else if (screenEl.msRequestFullscreen) {
      screenEl.msRequestFullscreen();
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    } else if (document.mozCancelFullScreen) {
      document.mozCancelFullScreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    }
  }
}

/* ---------- Init ---------- */
document.addEventListener('DOMContentLoaded', async () => {
  cacheDom();
  syncChatToggleBtn(); // garante estado visual correto no carregamento

  if (dom.npScrollWrapper) {
    dom.npScrollWrapper.addEventListener('animationend', handleNowPlayingAnimationEnd);
  }

  const screenEl = $('#screen');
  if (screenEl) {
    screenEl.addEventListener('click', () => {
      toggleFullscreen();
    });
  }



  // TV começa desligada, logo removemos a classe power-on do gabinete
  const cabinet = $('#tv-cabinet');
  if (cabinet) cabinet.classList.remove('power-on');

  initNoiseCanvas();

  // Inicializa estado de desligado
  updatePowerState();

  await syncTime();
  await loadChannels();

  if (typeof checkAuth === 'function') checkAuth();

  renderChannelBar();

  connectSocket();

  loadYouTubeAPI();

  // Desbloquear AudioContext na primeira interação com a página (necessário para políticas do navegador)
  const unlockAudio = () => {
    userInteracted = true;
    initAudioContext();
    
    if (isPowerOn) {
      if (player && playerReady) {
        let isMuted = true;
        try { isMuted = player.isMuted(); } catch(e) {}
        let isPlaying = false;
        try { isPlaying = player.getPlayerState() === YT.PlayerState.PLAYING; } catch(e) {}
        
        if (isMuted) {
          try {
            player.unMute();
            if (isPlaying) {
              startStaticToVideoTransition();
            } else {
              player.playVideo();
            }
          } catch(err) {}
        }
      }
      
      const isStaticVisible = dom.staticOverlay && dom.staticOverlay.classList.contains('show');
      if (isStaticVisible) {
        try {
          startNoiseSound();
        } catch(err) {}
      }
    }
    
    document.removeEventListener('click', unlockAudio);
    document.removeEventListener('touchstart', unlockAudio);
  };
  document.addEventListener('click', unlockAudio);
  document.addEventListener('touchstart', unlockAudio);

  setupChatInput();
  setupKnobs();

  startWatchdog();
});

/* Sincroniza o estado visual do botão de chat com a realidade do DOM */
function syncChatToggleBtn() {
  const chat = $('#chat-section');
  const btn  = $('#chat-toggle-push');
  if (!chat || !btn) return;
  const isCollapsed = chat.classList.contains('collapsed');
  document.body.classList.toggle('chat-open', !isCollapsed);
  if (isCollapsed) {
    btn.classList.remove('pressed');
  } else {
    btn.classList.add('pressed');
  }
}

/* ---------- Toggle Chat ---------- */
function toggleChat() {
  const chat = $('#chat-section');
  const btn = $('#chat-toggle-push');
  if (!chat || !btn) return;
  
  const isCollapsed = chat.classList.toggle('collapsed');
  document.body.classList.toggle('chat-open', !isCollapsed);
  if (isCollapsed) {
    btn.classList.remove('pressed');
  } else {
    btn.classList.add('pressed');
    scrollChat();
  }
}



/* ---------- Volume & Channel Knobs ---------- */
let volLevel = 3; // Starts at Level 3 (50%)
const volDirections = ['SW', 'W', 'NW', 'N', 'NE', 'E', 'SE'];

function getCardinalDirection(angle) {
  let norm = (angle % 360 + 360) % 360;
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  let index = Math.round(norm / 45) % 8;
  return directions[index];
}

function updateKnobImage(knobElement, angle) {
  if (!knobElement) return;
  const dir = getCardinalDirection(angle);
  knobElement.style.backgroundImage = `url('./img/Dial${dir}.png?v=2')`;
}

function updateVolumeKnob() {
  const volKnob = $('#vol-knob');
  if (!volKnob) return;
  const dir = volDirections[volLevel];
  volKnob.style.backgroundImage = `url('./img/Dial${dir}.png?v=2')`;
  
  // Calculate volume percentage: Level 0=0%, 1=17%, 2=33%, 3=50%, 4=67%, 5=83%, 6=100%
  userVolume = Math.round(volLevel * (100 / 6));
  
  const isStaticVisible = dom.staticOverlay && dom.staticOverlay.classList.contains('show');
  
  // Update static volume
  if (isStaticVisible && noiseGainNode && audioCtx && isPowerOn) {
    try {
      const maxStaticGain = 0.04;
      const staticGainVal = maxStaticGain * (userVolume / 100);
      noiseGainNode.gain.setValueAtTime(staticGainVal, audioCtx.currentTime);
    } catch(err) {}
  }
  
  // Update player volume
  if (player && playerReady && player.setVolume && !isStaticVisible && isPowerOn) {
    try {
      player.setVolume(userVolume);
    } catch(err) {}
  }
}

let volOsdTimeout = null;
function showVolumeHUD() {
  const volOsd = $('#osd-volume');
  if (!volOsd) return;

  const bars = $$('#osd-volume .vol-bar');
  bars.forEach((bar, idx) => {
    bar.classList.toggle('active', idx < volLevel);
  });

  volOsd.classList.add('show');
  clearTimeout(volOsdTimeout);
  volOsdTimeout = setTimeout(() => {
    volOsd.classList.remove('show');
  }, 2500);
}

function setupKnobs() {
  const volKnob = $('#vol-knob');
  const chKnob = $('#ch-knob');

  // Initialize initial knob images
  updateVolumeKnob();
  if (chKnob) {
    updateKnobImage(chKnob, currentChannel * 45);
  }

  if (volKnob) {
    volKnob.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.deltaY > 0) {
        // Scroll down: decrease level
        volLevel = Math.max(0, volLevel - 1);
      } else if (e.deltaY < 0) {
        // Scroll up: increase level
        volLevel = Math.min(6, volLevel + 1);
      }
      updateVolumeKnob();
      showVolumeHUD();
    }, { passive: false });
  }

  if (chKnob) {
    chKnob.addEventListener('wheel', (e) => {
      e.preventDefault();
      const now = Date.now();
      if (now - lastChScrollTime < 400) return; // Cooldown de 400ms para evitar girar canais descontroladamente
      lastChScrollTime = now;

      if (e.deltaY < 0) {
        // Scroll para cima: sentido horário (próximo canal)
        nextChannel();
      } else if (e.deltaY > 0) {
        // Scroll para baixo: sentido anti-horário (canal anterior)
        prevChannel();
      }
    }, { passive: false });
  }
}

function nextChannel() {
  if (!channels || channels.length === 0) return;
  const nextIdx = (currentChannel + 1) % channels.length;
  switchChannel(nextIdx);
}

function prevChannel() {
  if (!channels || channels.length === 0) return;
  const prevIdx = (currentChannel - 1 + channels.length) % channels.length;
  switchChannel(prevIdx);
}

/* ---------- Web Audio API — Chiado de Estática CRT ---------- */
let audioCtx = null;
let noiseNode = null;
let noiseGainNode = null;

function initAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function startNoiseSound() {
  initAudioContext();
  if (!audioCtx) return;
  
  stopNoiseSound(); // Limpa áudio anterior se houver
  
  // Cria 2 segundos de buffer de ruído branco
  const bufferSize = 2 * audioCtx.sampleRate;
  const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const output = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    output[i] = Math.random() * 2 - 1;
  }
  
  noiseNode = audioCtx.createBufferSource();
  noiseNode.buffer = noiseBuffer;
  noiseNode.loop = true;
  
  noiseGainNode = audioCtx.createGain();
  // Volume do chiado proporcional ao dial de volume (max 0.04)
  const maxStaticGain = 0.04;
  const staticGainVal = maxStaticGain * (userVolume / 100);
  noiseGainNode.gain.setValueAtTime(staticGainVal, audioCtx.currentTime);
  
  noiseNode.connect(noiseGainNode);
  noiseGainNode.connect(audioCtx.destination);
  noiseNode.start();
}

function fadeOutNoiseSound(durationMs) {
  if (!audioCtx || !noiseGainNode) return;
  try {
    const currentGain = noiseGainNode.gain.value;
    noiseGainNode.gain.setValueAtTime(currentGain, audioCtx.currentTime);
    const endTime = audioCtx.currentTime + durationMs / 1000;
    noiseGainNode.gain.linearRampToValueAtTime(0, endTime);
    setTimeout(() => {
      stopNoiseSound();
    }, durationMs);
  } catch(e) {
    stopNoiseSound();
  }
}

function stopNoiseSound() {
  if (noiseNode) {
    try {
      noiseNode.stop();
    } catch(e) {}
    noiseNode.disconnect();
    noiseNode = null;
  }
  if (noiseGainNode) {
    noiseGainNode.disconnect();
    noiseGainNode = null;
  }
}

/* Layout é puramente responsivo via CSS media queries — sem sistema de presets */

/* ============================================================
   TV IMAGE MODE HELPERS
   Call setTvImage(url, ratio, insets) to activate image mode.
   Call clearTvImage() to revert to CSS cabinet mode.

   Example:
     setTvImage('/img/tv-retro.png', '4/3', { t:'10%', l:'8%', r:'8%', b:'26%' });
   ============================================================ */
function setTvImage(imageUrl, frameRatio, insets) {
  const cabinet = document.getElementById('tv-cabinet');
  if (!cabinet) return;

  const root = document.documentElement.style;
  root.setProperty('--tv-bg-image', `url('${imageUrl}')`);
  if (frameRatio) root.setProperty('--tv-frame-ratio', frameRatio);
  if (insets) {
    if (insets.t) root.setProperty('--screen-t', insets.t);
    if (insets.l) root.setProperty('--screen-l', insets.l);
    if (insets.r) root.setProperty('--screen-r', insets.r);
    if (insets.b) root.setProperty('--screen-b', insets.b);
  }
  cabinet.classList.add('img-mode');
  document.body.classList.add('has-img-mode');
}

function clearTvImage() {
  const cabinet = document.getElementById('tv-cabinet');
  if (!cabinet) return;
  const root = document.documentElement.style;
  root.removeProperty('--tv-bg-image');
  root.removeProperty('--tv-frame-ratio');
  root.removeProperty('--screen-t');
  root.removeProperty('--screen-l');
  root.removeProperty('--screen-r');
  root.removeProperty('--screen-b');
  cabinet.classList.remove('img-mode');
  document.body.classList.remove('has-img-mode');
}

/* Keyboard shortcut: Alt+0 limpa image mode */
document.addEventListener('keydown', (e) => {
  if (!e.altKey) return;
  if (e.key === '0') { e.preventDefault(); clearTvImage(); }
});

/* ---------- Fade-in de Áudio do YouTube ---------- */
function fadeInYouTubeVolume(targetVol, durationMs) {
  if (!player || !playerReady || !player.setVolume) return;
  
  clearInterval(fadeInterval);
  player.setVolume(0);
  
  const stepTime = 50;
  const steps = durationMs / stepTime;
  let currentStep = 0;
  
  fadeInterval = setInterval(() => {
    if (!isPowerOn) {
      clearInterval(fadeInterval);
      try {
        player.setVolume(0);
        player.mute();
      } catch (e) {}
      return;
    }
    currentStep++;
    const volume = Math.min(targetVol, Math.round((currentStep / steps) * targetVol));
    try {
      player.setVolume(volume);
    } catch (e) {}
    
    if (currentStep >= steps) {
      clearInterval(fadeInterval);
    }
  }, stepTime);
}

/* ---------- Power Control Functions ---------- */
function togglePower() {
  isPowerOn = !isPowerOn;
  updatePowerState();
}

function updatePowerState() {
  const powerBtn = $('#power-push');
  const cabinet = $('#tv-cabinet');
  const screenOff = $('#screen-off-overlay');
  
  if (isPowerOn) {
    if (powerBtn) powerBtn.classList.add('pressed');
    if (cabinet) cabinet.classList.add('power-on');
    if (screenOff) screenOff.classList.add('hidden');
    
    // Simulate CRT power on
    userInteracted = true;
    initAudioContext();
    
    const ch = channels[currentChannel];
    const label = (ch && (ch.label || ch.name)) ? (ch.label || ch.name) : 'CH ' + String(currentChannel + 1).padStart(2, '0');
    showStaticOverlay(label.toUpperCase());
    triggerFlash();
    showChannelHUD(label);
    
    if (socket) {
      socket.emit('join-channel', { channel: currentChannel });
    }
    clearChatMessages();
    if (dom.chatChannelName) {
      dom.chatChannelName.textContent = 'CH ' + (currentChannel + 1);
    }
    
    clearTimeout(powerOnTimeout);
    powerOnTimeout = setTimeout(async () => {
      if (!isPowerOn) return;
      const state = await getSyncPlaybackState(currentChannel);
      if (state && isPowerOn) {
        loadVideo(state);
      } else {
        hideStaticOverlay();
      }
    }, 1200);
  } else {
    if (powerBtn) powerBtn.classList.remove('pressed');
    if (cabinet) cabinet.classList.remove('power-on');
    if (screenOff) screenOff.classList.remove('hidden');
    
    if (dom.nowPlaying) dom.nowPlaying.classList.remove('show');
    if (dom.channelHud) dom.channelHud.classList.remove('show');
    const volumeHud = $('#osd-volume');
    if (volumeHud) volumeHud.classList.remove('show');

    // Stop all audio & visual active animations
    clearTimeout(powerOnTimeout);
    stopNoiseSound();
    clearTimeout(staticAudioTimeout);
    clearTimeout(staticVisualTimeout);
    clearInterval(fadeInterval);
    hideStaticOverlayOnly();
    
    if (player && playerReady) {
      try {
        player.mute();
        player.setVolume(0);
        player.pauseVideo();
      } catch(e) {}
    }
  }
}
