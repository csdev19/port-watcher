import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import { api } from "@monorepo-template/convex-api/convex/_generated/api";

export const useCategories = () => {
  return useQuery(convexQuery(api.categories.list, {}));
};

export const useCreateCategory = () => {
  return useMutation(api.categories.create);
};

export const useDeleteCategory = () => {
  return useMutation(api.categories.remove);
};
