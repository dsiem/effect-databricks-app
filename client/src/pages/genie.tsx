import { PageTitle } from "../components/common";
import { GenieConversation } from "../components/genie/conversation";
import { GenieHeader } from "../components/genie/helper";
import { Card } from "../components/ui";

export default function AskGenie() {
  return (
    <>
      <PageTitle
        title="Ask Genie"
        description="Explain your data and explore further with Databricks Genie."
      />
      <Card className="h-[max(640px,calc(100dvh-240px))] gap-0 overflow-hidden py-0">
        <GenieHeader />
        <GenieConversation />
      </Card>
    </>
  );
}
