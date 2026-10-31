import { createFileRoute } from "@tanstack/react-router";
import { Console } from "@/components/scf/console";

export const Route = createFileRoute("/")({ component: Console });
