import { oc } from "@orpc/contract";
import { todoContract } from "./todo.contract";

export const contract = oc.router({ todo: todoContract });

export { todoContract };

export type Contract = typeof contract;
