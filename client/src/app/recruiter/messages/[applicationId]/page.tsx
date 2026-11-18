import { MessageThreadPage } from "@/components/messaging/MessagePages";

export default function RecruiterMessageThreadPage({
  params,
}: {
  params: { applicationId: string };
}) {
  return (
    <MessageThreadPage role="recruiter" applicationId={params.applicationId} />
  );
}
