/**
 * Base URL untuk seluruh endpoint REST API modul Leadership Race.
 * Menghapus trailing slash jika ada.
 */
export const API_BASE_URL = (
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) || ''
).replace(/\/$/, '');

/**
 * Host server Socket.IO utama.
 */
export const SOCKET_URL = (
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SOCKET_URL) || ''
).replace(/\/$/, '');

/**
 * Namespace Socket.IO khusus untuk modul Leadership Race.
 */
export const SOCKET_NAMESPACE = '/leadership-race';

/**
 * Path transport default Socket.IO pada server host.
 */
export const SOCKET_PATH = '/socket.io';

