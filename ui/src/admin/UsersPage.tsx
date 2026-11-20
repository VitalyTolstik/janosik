import { EntityPage } from "./EntityPage";
import { useEntityConfig } from "./entity-configs";

export default function UsersPage() {
  const config = useEntityConfig("users");
  return <EntityPage config={config} />;
}
