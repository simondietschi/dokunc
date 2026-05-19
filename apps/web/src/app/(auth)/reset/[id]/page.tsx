import { ResetForm } from "./ResetForm";

export default async function ResetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { id } = await params;
  const { token = "" } = await searchParams;
  return <ResetForm id={id} token={token} />;
}
