// Points the app's Firebase CDN imports at the local stand-ins.
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
