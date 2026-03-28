import { useState } from "react";
import { Text, Tooltip, Code } from "@radix-ui/themes";


export const abbreviateAddress = (
  string?: `0x${string}` | string,
  precision = 5,
  expanded = false,
): string => {
  if (!string) return "";
  if (expanded) return string;
  if (string.length <= precision * 2) return string;
  return `${string.slice(0, precision)}...${string.slice(-precision)}`;
};

export const clickToCopy = async (string: string): Promise<boolean> => {
    try {
      // Check if clipboard API is available
      if (!navigator.clipboard) {
        // Fallback for older browsers or non-HTTPS
        const textArea = document.createElement('textarea');
        textArea.value = string;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        
        if (successful) {
          console.log('Copied using fallback method');
          return true;
        } else {
          console.error('Fallback copy failed');
          return false;
        }
      }
      
      // Use modern clipboard API
      await navigator.clipboard.writeText(string);
      console.log('Copied using clipboard API');
      return true;
    } catch (err) {
      console.error('Failed to copy:', err);
      return false;
    }
  };
  
  // Updated CopyableCode component with better error handling
  export const CopyableCode = ({ 
    address, 
    precision = 5,
    size = "2" as const
  }: { 
    address: string;
    precision?: number;
    size?: "1" | "2" | "3";
  }) => {
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState(false);
    
    const handleCopy = async () => {
      const success = await clickToCopy(address);
      if (success) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1000);
      } else {
        setError(true);
        setTimeout(() => setError(false), 1000);
      }
    };
    
    return (
      <Tooltip content={copied ? "copied!" : error ? "failed" : "copy"}>
        <Code
          size={size}
          style={{ 
            cursor: 'pointer',
            wordBreak: 'break-all',
            transition: 'background-color 0.2s',
            backgroundColor: copied ? 'var(--green-3)' : error ? 'var(--red-3)' : undefined,
            display: 'inline-block',
            lineHeight: "2",
            verticalAlign: 'middle'
          }}
          onClick={handleCopy}
        >
          {abbreviateAddress(address, precision)}
        </Code>
      </Tooltip>
    );
  };
  
  // For Code components that might need to show full address
  export const ExpandableCode = ({ 
    address, 
    precision = 5,
    size = "2" as const,
    showFullOnClick = true
  }: { 
    address: string;
    precision?: number;
    size?: "1" | "2" | "3";
    showFullOnClick?: boolean;
  }) => {
    const [copied, setCopied] = useState(false);
    const [expanded, setExpanded] = useState(false);
    
    const handleClick = async () => {
      if (showFullOnClick) {
        setExpanded(!expanded);
      } else {
        const success = await clickToCopy(address);
        if (success) {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }
      }
    };
    
    const displayAddress = expanded ? address : abbreviateAddress(address, precision);
    
    return (
      <Tooltip content={copied ? "Copied!" : expanded ? "Click to collapse" : "Click to expand/copy"}>
        <Code
          size={size}
          style={{ 
            cursor: 'pointer',
            wordBreak: 'break-all',
            transition: 'background-color 0.2s',
            backgroundColor: copied ? 'var(--green-3)' : undefined
          }}
          onClick={handleClick}
        >
          {displayAddress}
        </Code>
      </Tooltip>
    );
  };

