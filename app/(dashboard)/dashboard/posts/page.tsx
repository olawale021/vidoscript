import { redirect } from "next/navigation";

// Posts moved into Socials → "Posted from VidoScript".
export default function PostsPage() {
  redirect("/dashboard/socials?tab=posted");
}
