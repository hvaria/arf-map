import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

export function SearchBar({ value, onChange }: SearchBarProps) {
  return (
    <div className="relative" data-testid="search-bar">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        type="search"
        placeholder="Search by name, address, city, zip, or license #..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-9 pr-9 h-10 bg-background/95 backdrop-blur-sm shadow-lg border-border/60 text-sm"
        data-testid="input-search"
      />
      {value && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
          onClick={() => onChange("")}
          data-testid="button-clear-search"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
