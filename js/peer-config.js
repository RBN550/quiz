// Shared PeerJS server configuration for host and player
export const PEER_OPTIONS = {
  debug: 0,
  host:   'fulllifegames.com',
  port:   443,
  path:   '/quiz-app',
  secure: true,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      { urls: 'turn:numb.viagenie.ca',                            username: 'webrtc@live.com',      credential: 'muazkh' },
      { urls: 'turn:numb.viagenie.ca?transport=tcp',              username: 'webrtc@live.com',      credential: 'muazkh' },
      { urls: 'turn:openrelay.metered.ca:80',                     username: 'openrelayproject',     credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:80?transport=tcp',       username: 'openrelayproject',     credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443',                    username: 'openrelayproject',     credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443?transport=tcp',      username: 'openrelayproject',     credential: 'openrelayproject' },
      { urls: 'turns:openrelay.metered.ca:443',                   username: 'openrelayproject',     credential: 'openrelayproject' },
    ],
  },
};
