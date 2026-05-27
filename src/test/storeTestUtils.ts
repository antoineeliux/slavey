import { useAppStore } from "../store/appStore";

export function resetAppStore(): void {
  useAppStore.setState(useAppStore.getInitialState(), true);
}
