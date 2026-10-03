import { useEffect, useRef, useState } from "react";
import { CreditCard, Nfc } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusPill } from "@/components/admin/primitives";
import { getDependentCard, removeDependentCard, tagDependentCard } from "@/lib/cards.functions";
import { dateTime } from "@/lib/format";

type NdefReading = { serialNumber?: string; message?: { records: { recordType: string; data?: DataView }[] } };
type NdefReaderLike = {
  scan: (opts?: { signal?: AbortSignal }) => Promise<void>;
  addEventListener: (type: "reading" | "readingerror", cb: (e: NdefReading) => void) => void;
};

export function CardTagging({ userId }: { userId: string }) {
  const fetchCard = useServerFn(getDependentCard);
  const remove = useServerFn(removeDependentCard);
  const qc = useQueryClient();
  const [tapOpen, setTapOpen] = useState(false);
  const { data: card, isLoading } = useQuery({
    queryKey: ["card", userId],
    queryFn: () => fetchCard({ data: { userId } }),
  });

  async function onRemove() {
    if (!confirm("Remove this card from the dependent?")) return;
    try {
      await remove({ data: { userId } });
      toast.success("Card removed");
      qc.invalidateQueries({ queryKey: ["card", userId] });
      qc.invalidateQueries({ queryKey: ["dependents"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Card tagging</h3>
        {!card && !isLoading ? (
          <Button size="sm" onClick={() => setTapOpen(true)}>
            <Nfc className="size-4" /> Tag card
          </Button>
        ) : null}
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : card ? (
        <div className="panel space-y-2 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CreditCard className="size-4 text-primary" />
              <span className="figure text-sm font-semibold">{card.card_uid}</span>
            </div>
            <StatusPill value={card.status} />
          </div>
          <p className="text-xs text-muted-foreground">
            {card.card_type ?? "NFC"} · tagged {dateTime(card.tagged_at)}
          </p>
          {card.card_data ? (
            <p className="figure break-all rounded bg-muted/40 p-2 text-[11px] text-muted-foreground">{card.card_data}</p>
          ) : null}
          <div className="flex gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={() => setTapOpen(true)}>
              Change card
            </Button>
            <Button size="sm" variant="destructive" onClick={onRemove}>
              Remove card
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No card tagged to this dependent.</p>
      )}
      <TapDialog userId={userId} open={tapOpen} onOpenChange={setTapOpen} changing={!!card} />
    </section>
  );
}

function TapDialog({ userId, open, onOpenChange, changing }: { userId: string; open: boolean; onOpenChange: (o: boolean) => void; changing: boolean }) {
  const tag = useServerFn(tagDependentCard);
  const qc = useQueryClient();
  const [uid, setUid] = useState("");
  const [cardData, setCardData] = useState("");
  const [busy, setBusy] = useState(false);
  const [webNfc, setWebNfc] = useState<"idle" | "scanning" | "unsupported">("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setUid("");
    setCardData("");
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    const ctrl = new AbortController();
    const W = window as unknown as { NDEFReader?: new () => NdefReaderLike };
    if (W.NDEFReader) {
      const reader = new W.NDEFReader();
      reader
        .scan({ signal: ctrl.signal })
        .then(() => {
          setWebNfc("scanning");
          reader.addEventListener("reading", (e) => {
            const serial = (e.serialNumber ?? "").replace(/:/g, "").toUpperCase();
            const texts = (e.message?.records ?? [])
              .map((r) => (r.data ? new TextDecoder().decode(r.data) : r.recordType))
              .join(" | ");
            if (serial) setUid(serial);
            setCardData(texts);
          });
        })
        .catch(() => setWebNfc("unsupported"));
    } else setWebNfc("unsupported");
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [open]);

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    const clean = uid.replace(/[^0-9a-zA-Z]/g, "");
    if (clean.length < 4) {
      toast.error("Tap a card on the reader first.");
      return;
    }
    setBusy(true);
    try {
      await tag({ data: { userId, cardUid: clean, cardType: "NFC", ...(cardData ? { cardData } : {}) } });
      toast.success(changing ? "Card changed" : "Card tagged");
      qc.invalidateQueries({ queryKey: ["card", userId] });
      qc.invalidateQueries({ queryKey: ["dependents"] });
      onOpenChange(false);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{changing ? "Change card" : "Tag NFC card"}</DialogTitle>
          <DialogDescription>Tap the NFC card on the reader now. The card number fills in automatically.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <div className="panel flex flex-col items-center gap-2 p-6 text-center">
            <Nfc className={`size-10 text-primary ${uid ? "" : "animate-pulse"}`} />
            <p className="text-sm">{uid ? "Card detected" : "Waiting for card tap…"}</p>
            <p className="text-xs text-muted-foreground">
              {webNfc === "scanning" ? "Phone NFC is listening." : "USB card reader: keep this window focused and tap the card."}
            </p>
          </div>
          <label className="block text-sm">
            Card number (UID)
            <Input ref={inputRef} value={uid} onChange={(e) => setUid(e.target.value)} placeholder="Tap card…" className="figure" autoComplete="off" />
          </label>
          {cardData ? <p className="figure break-all text-[11px] text-muted-foreground">{cardData}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || !uid}>{busy ? "Saving…" : "Save card"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
