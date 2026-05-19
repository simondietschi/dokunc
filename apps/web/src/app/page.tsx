import { redirect } from "next/navigation";
import { getUserId } from "@/lib/session";

export default async function Home() {
  const uid = await getUserId();
  redirect(uid ? "/spaces" : "/login");
}
