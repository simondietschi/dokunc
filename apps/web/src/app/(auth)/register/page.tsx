import type { Metadata } from "next";
import { AuthForm } from "../AuthForm";

export const metadata: Metadata = {
  title: "Registrieren",
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <AuthForm mode="register" next={next} />;
}
