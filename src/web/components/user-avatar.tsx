import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { cn } from "./ui/class-names";

const MAX_INITIALS = 2;

function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, MAX_INITIALS)
    .toUpperCase();
}

/** A user's profile photo, or their initials while it loads or when there is none. */
export function UserAvatar({
  name,
  image,
  className,
}: {
  readonly name: string;
  readonly image: string | null;
  readonly className?: string;
}) {
  return (
    <Avatar className={cn("size-9", className)}>
      {image == null ? null : <AvatarImage src={image} alt="" />}
      <AvatarFallback className="bg-primary text-xs font-bold text-primary-foreground">
        {initialsOf(name)}
      </AvatarFallback>
    </Avatar>
  );
}
