import { redirect } from "next/navigation";

// Eski deneme adresi: evren artık ana ekran ("/"). Eski bağlantılar bozulmasın.
export default function EvrenPage() {
  redirect("/");
}
