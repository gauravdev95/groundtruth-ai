import { MessageThreadPage } from "@/components/messaging/MessagePages";

export default function StudentMessageThreadPage({
  params,
}: {
  params: { applicationId: string };
}) {
  return (
    <MessageThreadPage role="candidate" applicationId={params.applicationId} />
  );
}
