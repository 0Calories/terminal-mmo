// Bun inlines `.zone` files as text at bundle time (ADR 0008): the published CLI
// has no `zones/` dir on disk, so the authored content rides in the bundle, while
// the server reads the same files off disk at runtime. Either way the import is a
// raw string handed to the pure `parseZone`.
declare module '*.zone' {
	const text: string;
	export default text;
}
