import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// Ephemeral styling for live dictation — rendered as ProseMirror decorations so
// nothing leaks into the saved document (no marks, clean undo history).
//   • interim  : range of not-yet-final words, shown tentative (dimmed)
//   • settling : range just finalized, runs a one-shot settle animation
//   • caret    : a pulsing live caret at the insertion point while recording

export const dictationKey = new PluginKey<DictationState>('dictation');

type Range = { from: number; to: number };
export type DictationState = {
	interim: Range | null;
	settling: Range | null;
};

export const DictationDecoration = Extension.create({
	name: 'dictationDecoration',
	addProseMirrorPlugins() {
		return [
			new Plugin<DictationState>({
				key: dictationKey,
				state: {
					init: () => ({ interim: null, settling: null }),
					apply(tr, value) {
						const meta = tr.getMeta(dictationKey) as Partial<DictationState> | undefined;
						let next: DictationState = meta ? { ...value, ...meta } : value;
						if (tr.docChanged) {
							const mapR = (r: Range | null) =>
								r ? { from: tr.mapping.map(r.from), to: tr.mapping.map(r.to) } : null;
							next = {
								interim: mapR(next.interim),
								settling: mapR(next.settling)
							};
						}
						return next;
					}
				},
				props: {
					decorations(state) {
						const s = dictationKey.getState(state);
						if (!s) return null;
						const decos: Decoration[] = [];
						if (s.interim && s.interim.to > s.interim.from) {
							decos.push(Decoration.inline(s.interim.from, s.interim.to, { class: 'dictation-interim' }));
						}
						if (s.settling && s.settling.to > s.settling.from) {
							decos.push(
								Decoration.inline(s.settling.from, s.settling.to, { class: 'dictation-settling' })
							);
						}
						// We no longer render a separate widget caret here because the
						// editor already shows a native input caret. Keeping both
						// created duplicate carets; omit the widget to rely on the
						// editor's built-in selection caret instead.
						return DecorationSet.create(state.doc, decos);
					}
				}
			})
		];
	}
});
