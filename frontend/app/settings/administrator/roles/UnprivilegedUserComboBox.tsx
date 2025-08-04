import { PopoverTrigger } from "@radix-ui/react-popover";
import { Check, ChevronDown, Mail, User } from "lucide-react";
import React, { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/utils";

// The shape of each option
// email is used as value
// name is used as label
type Option = {
  id?: string | undefined;
  email: string;
  name: string;
  isInvestor: boolean;
  isContractor: boolean;
};

interface OptionItemProps {
  option: Option;
  isSelected: boolean;
  onSelect: (option: Option) => void;
  isInvite?: boolean;
}

// Main Component Props
interface ComboBoxProps extends Omit<React.ComponentProps<typeof Button>, "value" | "onChange"> {
  options?: Option[];
  value: Option | null | undefined;
  onChange: (value: Option) => void;
  placeholder?: string;
  modal?: boolean;
}

/**
 * A searchable dropdown component for selecting a single user or inviting a new one.
 */
const ComboBox = ({ options = [], value, onChange, placeholder = "Select...", className, ...props }: ComboBoxProps) => {
  // 1. State Management
  const [isOpen, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  // 2. Data Preparation (delegated to a custom hook)
  const { contractors, investors, suggestions, others, getLabelForValue } = useCategorizedOptions(
    options,
    searchQuery,
    value,
  );

  // 3. Event Handlers
  const handleSelect = (selectedOption: Option) => {
    onChange(selectedOption);
    setOpen(false);
  };

  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    // Reset scroll to top on new search
    requestAnimationFrame(() => listRef.current?.scrollTo(0, 0));
  };

  // 4. Render Logic
  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="small"
          role="combobox"
          aria-expanded={isOpen}
          {...props}
          className={cn("w-full min-w-0 justify-between", className)}
        >
          <div className="flex items-center gap-2 truncate text-black">
            <span className="span-4">
              {value?.id ? (
                <User className="text-muted-foreground size-4" />
              ) : (
                <Mail className="text-muted-foreground size-4" />
              )}
            </span>
            {value ? getLabelForValue(value) : placeholder}
          </div>
          <ChevronDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="p-0"
        style={{ width: "var(--radix-popover-trigger-width)" }}
        align="start"
        sideOffset={4}
      >
        <Command>
          <CommandInput className="text-black" placeholder={placeholder} onValueChange={handleSearchChange} />
          {/* radix scroll lock workaround */}
          <CommandList ref={listRef} className="max-h-[300px] overflow-y-auto" onWheel={(e) => e.stopPropagation()}>
            <CommandEmpty>{searchQuery ? "No results. Press Enter to invite." : "No results found."}</CommandEmpty>
            {suggestions.length > 0 && (
              <CommandGroup heading="Press Enter to invite this email">
                {suggestions.map((option) => (
                  <OptionItem
                    key={option.email}
                    option={option}
                    isSelected={value?.email === option.email}
                    isInvite={option.email === searchQuery}
                    onSelect={handleSelect}
                  />
                ))}
              </CommandGroup>
            )}
            {contractors.length > 0 && (
              <CommandGroup heading="Workspace Contractors">
                {contractors.map((option) => (
                  <OptionItem
                    key={option.email}
                    option={option}
                    isSelected={value?.email === option.email}
                    onSelect={handleSelect}
                  />
                ))}
              </CommandGroup>
            )}
            {investors.length > 0 && (
              <CommandGroup heading="Workspace Investors">
                {investors.map((option) => (
                  <OptionItem
                    key={option.email}
                    option={option}
                    isSelected={value?.email === option.email}
                    onSelect={handleSelect}
                  />
                ))}
              </CommandGroup>
            )}
            {others.length > 0 && (
              <CommandGroup heading="Workspace Members">
                {investors.map((option) => (
                  <OptionItem
                    key={option.email}
                    option={option}
                    isSelected={value?.email === option.email}
                    onSelect={handleSelect}
                  />
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

const OptionItem = ({ option, isSelected, onSelect }: OptionItemProps) => (
  <CommandItem
    value={option.email}
    keywords={[option.email, option.name]}
    onSelect={() => onSelect(option)}
    className="flex cursor-pointer items-center gap-2"
  >
    <Check className={cn("size-4", isSelected ? "opacity-100" : "opacity-0")} />
    <div className="flex flex-col">
      {option.name && option.name !== option.email ? (
        <span className="font-medium text-black">{option.name}</span>
      ) : null}
      <span
        className={cn("text-sm", option.name && option.name !== option.email ? "text-muted-foreground" : "font-medium")}
      >
        {option.email}
      </span>
    </div>
  </CommandItem>
);

const useCategorizedOptions = (options: Option[], query: string, value: Option | null | undefined) => {
  // Memoize the base categorization of investors and contractors.
  const { investors, contractors, others } = useMemo(() => {
    const investors: Option[] = [];
    const contractors: Option[] = [];
    const others: Option[] = [];

    for (const opt of options) {
      if (opt.isInvestor) investors.push(opt);
      else if (opt.isContractor) contractors.push(opt);
      else others.push(opt);
    }

    return { investors, contractors, others };
  }, [options]);

  // Create a dynamic list of suggestions based on the search query.
  const suggestions = useMemo<Option[]>(() => {
    const list: Option[] = [];
    if (!query && value == null) {
      return list;
    }

    if (query.length > 0) {
      list.push({
        name: query,
        email: query,
        isContractor: false,
        isInvestor: false,
      });
    }

    if (value && query !== value.email) {
      list.push(value);
    }

    return list;
  }, [query, value]);

  // Create a single, memoized map for efficient label lookups.
  const labelMap = useMemo(() => {
    const map = new WeakMap<Option, string>();
    for (const opt of [...investors, ...contractors, ...suggestions, ...others]) {
      map.set(opt, opt.id ? opt.name : opt.email);
    }
    return map;
  }, [investors, contractors, suggestions, others]);

  // Expose a stable function to get a label for a given value.
  const getLabelForValue = (value: Option) => ((labelMap.get(value) ?? value.id) ? value.name : value.email);

  return {
    investors,
    contractors,
    suggestions,
    others,
    getLabelForValue,
  };
};

export default ComboBox;
