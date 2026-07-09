// Bun inlines `.zone` files as text at bundle time (no `zones/` dir ships).
declare module '*.zone' {
	const text: string;
	export default text;
}
