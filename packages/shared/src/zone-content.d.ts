// Bun inlines `.zone` files as text at bundle time: the published CLI has no
// `zones/` dir on disk, so authored content must ride in the bundle (ADR 0008).
declare module '*.zone' {
	const text: string;
	export default text;
}
