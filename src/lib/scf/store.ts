import { create } from "zustand";
import { persist } from "zustand/middleware";
import { apply, initialModel, type Command, type Model, type Result } from "./model";

export type TabId = "fabric" | "circuits" | "ledger" | "evidence";

type Dispatchable = {
  [K in Command["type"]]: Omit<Extract<Command, { type: K }>, "txId"> & { txId?: string };
}[Command["type"]];

type FabricStore = {
  model: Model;
  tab: TabId;
  selectedId: number | null;
  setTab: (tab: TabId) => void;
  select: (id: number | null) => void;
  dispatch: (command: Dispatchable) => Result;
};

function usable(model: Model | undefined): model is Model {
  return !!model && Array.isArray(model.links) && Array.isArray(model.circuits) && Array.isArray(model.ledger);
}

export const useFabric = create<FabricStore>()(
  persist(
    (set, get) => ({
      model: initialModel(),
      tab: "fabric",
      selectedId: null,
      setTab: (tab) => set({ tab }),
      select: (selectedId) => set({ selectedId }),
      dispatch: (partial) => {
        const current = get().model;
        const txId = partial.txId ?? `tx-${current.nextTx}`;
        const command = { ...partial, txId } as Command;
        const out = apply(current, command);
        const patch: Partial<FabricStore> = { model: out.model };
        if (partial.type === "create" && out.result.ok) {
          patch.selectedId = out.model.nextId - 1;
          patch.tab = "circuits";
        }
        if (partial.type === "reset" && out.result.ok) {
          patch.selectedId = null;
          patch.tab = "fabric";
        }
        if (partial.type === "pricingVector") patch.tab = "ledger";
        set(patch);
        return out.result;
      },
    }),
    {
      name: "scf-exchange-v1",
      skipHydration: true,
      partialize: (state) => ({
        model: state.model,
        tab: state.tab,
        selectedId: state.selectedId,
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<FabricStore> | undefined;
        if (!usable(saved?.model)) return current;
        return {
          ...current,
          model: saved.model,
          tab: saved.tab ?? current.tab,
          selectedId: saved.selectedId ?? null,
        };
      },
    },
  ),
);
