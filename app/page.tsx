import Universe from "@/components/Universe";

// Nova ana ekranı: projeler uzayda yörüngede dönen gezegenler; tıklayınca proje
// sayfası (müdür + ekip, sohbet, dosyalar, hafıza, raporlar…).
export default function Home() {
  return (
    <div style={{ height: "100dvh", width: "100vw" }}>
      <Universe />
    </div>
  );
}
