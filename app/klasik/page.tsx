import AppShell from "@/components/AppShell";

// Eski Nova paneli — yalnız burada bulunan araçlar için (Fatura okuma, Kontrol/bütçe,
// Denetim kaydı, Sürümler, Loops, Brifing). Ana ekran artık "/" (evren).
export default function Klasik() {
  return (
    <>
      <AppShell />
      <a
        href="/"
        className="fixed bottom-4 right-4 z-[200] flex h-11 items-center gap-2 rounded-full px-4 text-[13px] font-bold shadow-lg transition-transform duration-200 hover:scale-105"
        style={{ background: "var(--grad)", color: "#0b1030", boxShadow: "0 8px 24px rgba(139,92,255,.45)" }}
        aria-label="Nova ana ekranına dön"
      >
        ← Nova
      </a>
    </>
  );
}
