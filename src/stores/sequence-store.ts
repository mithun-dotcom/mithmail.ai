import { create } from "zustand";
import type { StepDraft, Variant } from "@/lib/campaign-types";

interface SequenceState {
  steps: StepDraft[];
  selected: number;
  variant: string; // "A" = the step itself, otherwise a variant id
  dirty: boolean;
  init: (steps: StepDraft[]) => void;
  select: (i: number) => void;
  selectVariant: (id: string) => void;
  update: (i: number, patch: Partial<StepDraft>) => void;
  updateVariant: (i: number, id: string, patch: Partial<Variant>) => void;
  addStep: () => void;
  removeStep: (i: number) => void;
  moveStep: (i: number, dir: -1 | 1) => void;
  addVariant: (i: number) => void;
  removeVariant: (i: number, id: string) => void;
  replaceAll: (steps: StepDraft[]) => void;
  markSaved: () => void;
}

const renumber = (steps: StepDraft[]) => steps.map((s, i) => ({ ...s, stepNumber: i + 1, waitDays: i === 0 ? 0 : s.waitDays }));

export const useSequence = create<SequenceState>((set) => ({
  steps: [],
  selected: 0,
  variant: "A",
  dirty: false,
  init: (steps) => set({ steps, selected: 0, variant: "A", dirty: false }),
  select: (selected) => set({ selected, variant: "A" }),
  selectVariant: (variant) => set({ variant }),
  update: (i, patch) => set((s) => ({ dirty: true, steps: s.steps.map((st, j) => (j === i ? { ...st, ...patch } : st)) })),
  updateVariant: (i, id, patch) =>
    set((s) => ({
      dirty: true,
      steps: s.steps.map((st, j) => (j === i ? { ...st, variants: st.variants.map((v) => (v.id === id ? { ...v, ...patch } : v)) } : st)),
    })),
  addStep: () =>
    set((s) => ({
      dirty: true,
      selected: s.steps.length,
      variant: "A",
      steps: renumber([...s.steps, { stepNumber: s.steps.length + 1, waitDays: 3, subject: "", body: "", variants: [] }]),
    })),
  removeStep: (i) =>
    set((s) => (s.steps.length <= 1 ? s : { dirty: true, selected: Math.max(0, i - 1), variant: "A", steps: renumber(s.steps.filter((_, j) => j !== i)) })),
  moveStep: (i, dir) =>
    set((s) => {
      const j = i + dir;
      if (j < 0 || j >= s.steps.length) return s;
      const steps = [...s.steps];
      [steps[i], steps[j]] = [steps[j], steps[i]];
      return { dirty: true, selected: j, steps: renumber(steps) };
    }),
  addVariant: (i) =>
    set((s) => {
      const st = s.steps[i];
      if (st.variants.length >= 3) return s;
      const id = String.fromCharCode(66 + st.variants.length); // B, C, D
      return {
        dirty: true,
        variant: id,
        steps: s.steps.map((x, j) => (j === i ? { ...x, variants: [...x.variants, { id, subject: x.subject, body: x.body, weight: 50 }] } : x)),
      };
    }),
  removeVariant: (i, id) =>
    set((s) => ({ dirty: true, variant: "A", steps: s.steps.map((x, j) => (j === i ? { ...x, variants: x.variants.filter((v) => v.id !== id) } : x)) })),
  replaceAll: (steps) => set({ dirty: true, selected: 0, variant: "A", steps: renumber(steps) }),
  markSaved: () => set({ dirty: false }),
}));
