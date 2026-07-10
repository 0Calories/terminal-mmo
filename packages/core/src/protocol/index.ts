// protocol — the client/server wire messages and version gating.

export { CHAT_MAX_LEN } from './constants';
export {
	type AvatarSnapshot,
	type ClientMessage,
	decodeClientMessage,
	decodeServerMessage,
	encodeClientMessage,
	encodeServerMessage,
	type MonsterSnapshot,
	type ServerMessage,
} from './protocol';
export {
	DEV_VERSION,
	isReleaseVersion,
} from './version';
