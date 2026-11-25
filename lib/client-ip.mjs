import { isIP } from 'node:net';

const normalize = address => address?.startsWith('::ffff:') && isIP(address.slice(7)) === 4
  ? address.slice(7) : address;

export function clientIp(req, trustedProxy) {
  const peer = normalize(req.socket.remoteAddress);
  if (!trustedProxy || peer !== normalize(trustedProxy)) return peer;
  const forwarded = req.headers['x-forwarded-for'];
  const address = typeof forwarded === 'string' ? forwarded.trim() : '';
  return isIP(address) ? normalize(address) : peer;
}
