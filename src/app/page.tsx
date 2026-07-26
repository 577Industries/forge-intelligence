import { redirect } from "next/navigation";

/** The console is the product; the root is just a doorway to it. */
export default function Home() {
  redirect("/intelligence/app");
}
