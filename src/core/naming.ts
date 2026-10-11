/**
 * DG Domain Core - Naming Conventions & Policy Rules
 * Copyright (c) 2026 Deep Group
 *
 * Enforces RFC-aligned label syntax, prototype .dg namespace boundaries,
 * reserved names protection, and explicit ICANN disclaimer notices.
 */

export const PROTOTYPE_TLD = 'dg';
export const PROTOTYPE_TLD_SUFFIX = '.dg';

/**
 * Standard legal and technical disclaimer for the prototype namespace.
 * MUST be present in lookup results, registry metadata, and API payloads.
 */
export const PROTOTYPE_DISCLAIMER =
  "PROTOTYPE NAMESPACE NOTICE: The '.dg' naming system is an independent private overlay architecture developed by Deep Group for technical prototyping and research. It is NOT an ICANN-delegated public top-level domain (TLD) and does not resolve via standard public Internet DNS root servers.";

/**
 * Reserved domain names protected from public registration.
 * Reserved for core infrastructure, registry operations, protocol standards, and security.
 */
export const RESERVED_DOMAINS = new Set([
  'nic.dg',
  'whois.dg',
  'dns.dg',
  'root.dg',
  'registry.dg',
  'localhost.dg',
  'iana.dg',
  'icann.dg',
  'gov.dg',
  'bank.dg',
  'dg.dg',
  'ns1.dg',
  'ns2.dg',
  'example.dg',
  'test.dg',
  'invalid.dg',
]);

export interface ValidationSuccess {
  valid: true;
  normalizedName: string;
  labels: string[];
  sld: string; // second-level domain name (e.g. 'deepgroup' in 'deepgroup.dg')
}

export interface ValidationFailure {
  valid: false;
  error: string;
  code: 'INVALID_SYNTAX' | 'INVALID_TLD' | 'RESERVED_NAME' | 'LENGTH_EXCEEDED' | 'EMPTY_LABEL';
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

/**
 * Normalizes a raw domain query string:
 * - Trims whitespace
 * - Converts to lower-case ASCII
 * - Strips trailing dot if present (FQDN representation)
 */
export function normalizeDomain(rawDomain: string): string {
  if (!rawDomain) return '';
  let cleaned = rawDomain.trim().toLowerCase();
  if (cleaned.endsWith('.')) {
    cleaned = cleaned.slice(0, -1);
  }
  return cleaned;
}

/**
 * Validates domain naming rules for the .dg prototype namespace.
 * Rules:
 * 1. Must end with '.dg'.
 * 2. Total length between 4 and 253 characters (minimum e.g. 'a.dg').
 * 3. Each label 1-63 characters.
 * 4. Allowed characters: [a-z0-9] and '-' (hyphen).
 * 5. Hyphens cannot be the first or last character of any label.
 * 6. Cannot match the protected reserved domain names list.
 */
export function validateDomainName(rawName: string, allowReserved = false): ValidationResult {
  if (!rawName || typeof rawName !== 'string') {
    return {
      valid: false,
      error: 'Domain name cannot be empty',
      code: 'INVALID_SYNTAX',
    };
  }

  const normalized = normalizeDomain(rawName);

  if (normalized.length === 0) {
    return {
      valid: false,
      error: 'Domain name cannot be empty',
      code: 'INVALID_SYNTAX',
    };
  }

  if (normalized.length > 253) {
    return {
      valid: false,
      error: 'Domain name exceeds maximum total length of 253 characters',
      code: 'LENGTH_EXCEEDED',
    };
  }

  const parts = normalized.split('.');

  if (parts.length < 2) {
    return {
      valid: false,
      error: `Domain must include the prototype TLD suffix '.dg' (e.g. '${normalized}.dg')`,
      code: 'INVALID_TLD',
    };
  }

  const tld = parts[parts.length - 1];
  if (tld !== PROTOTYPE_TLD) {
    return {
      valid: false,
      error: `Invalid TLD '.${tld}'. This prototype registry strictly manages the '.dg' namespace.`,
      code: 'INVALID_TLD',
    };
  }

  // Validate each label according to RFC 1035 / RFC 1123
  for (let i = 0; i < parts.length; i++) {
    const label = parts[i];

    if (label.length === 0) {
      return {
        valid: false,
        error: 'Domain contains an empty label or consecutive dots',
        code: 'EMPTY_LABEL',
      };
    }

    if (label.length > 63) {
      return {
        valid: false,
        error: `Label '${label}' exceeds maximum length of 63 characters`,
        code: 'LENGTH_EXCEEDED',
      };
    }

    // Must start and end with an alphanumeric character
    if (!/^[a-z0-9]/.test(label)) {
      return {
        valid: false,
        error: `Label '${label}' must start with an alphanumeric character [a-z0-9]`,
        code: 'INVALID_SYNTAX',
      };
    }

    if (!/[a-z0-9]$/.test(label)) {
      return {
        valid: false,
        error: `Label '${label}' must end with an alphanumeric character [a-z0-9]`,
        code: 'INVALID_SYNTAX',
      };
    }

    // Entire label must only contain a-z, 0-9, and hyphen
    if (!/^[a-z0-9-]+$/.test(label)) {
      return {
        valid: false,
        error: `Label '${label}' contains invalid characters. Only [a-z0-9-] are permitted.`,
        code: 'INVALID_SYNTAX',
      };
    }
  }

  // Check reserved domains list
  if (!allowReserved && RESERVED_DOMAINS.has(normalized)) {
    return {
      valid: false,
      error: `The domain '${normalized}' is reserved for core infrastructure and cannot be registered.`,
      code: 'RESERVED_NAME',
    };
  }

  const sld = parts[parts.length - 2];

  return {
    valid: true,
    normalizedName: normalized,
    labels: parts,
    sld,
  };
}

/**
 * Validates resource record syntax based on standard record types.
 */
export function validateRecordValue(type: string, value: string): { valid: boolean; error?: string } {
  if (!value || typeof value !== 'string') {
    return { valid: false, error: 'Record value cannot be empty' };
  }

  const trimmed = value.trim();

  switch (type) {
    case 'A': {
      // IPv4 regex (0.0.0.0 - 255.255.255.255)
      const ipv4Regex =
        /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
      if (!ipv4Regex.test(trimmed)) {
        return { valid: false, error: `Invalid IPv4 address for A record: '${value}'` };
      }
      return { valid: true };
    }

    case 'AAAA': {
      // IPv6 validation
      const ipv6Regex =
        /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1{0,1}[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1{0,1}[0-9])?[0-9]))$/;
      if (!ipv6Regex.test(trimmed)) {
        return { valid: false, error: `Invalid IPv6 address for AAAA record: '${value}'` };
      }
      return { valid: true };
    }

    case 'CNAME': {
      const normalizedTarget = normalizeDomain(trimmed);
      if (!normalizedTarget || normalizedTarget.length > 253) {
        return { valid: false, error: `Invalid host target for CNAME record: '${value}'` };
      }
      const labels = normalizedTarget.split('.');
      for (const label of labels) {
        if (!label || label.length > 63) {
          return { valid: false, error: `Invalid host label in CNAME target: '${label}'` };
        }
        if (!/^[a-z0-9]/.test(label) || !/[a-z0-9]$/.test(label)) {
          return { valid: false, error: `CNAME host label '${label}' must start and end with alphanumeric character` };
        }
        if (!/^[a-z0-9-]+$/.test(label)) {
          return { valid: false, error: `CNAME host label '${label}' contains invalid characters` };
        }
      }
      return { valid: true };
    }

    case 'TXT': {
      if (trimmed.length > 1024) {
        return { valid: false, error: 'TXT record value exceeds max length of 1024 characters' };
      }
      return { valid: true };
    }

    case 'MX': {
      const normalizedHost = normalizeDomain(trimmed);
      if (!/^[a-z0-9.-]+$/.test(normalizedHost)) {
        return { valid: false, error: `Invalid mail host target for MX record: '${value}'` };
      }
      return { valid: true };
    }

    case 'NS': {
      const normalizedNs = normalizeDomain(trimmed);
      if (!/^[a-z0-9.-]+$/.test(normalizedNs)) {
        return { valid: false, error: `Invalid nameserver host for NS record: '${value}'` };
      }
      return { valid: true };
    }

    default:
      return { valid: false, error: `Unsupported record type '${type}'` };
  }
}

export const MIN_TTL_SECONDS = 30;
export const MAX_TTL_SECONDS = 604800; // 7 days

/**
 * Validates DNS record TTL (Time To Live).
 * Ensures TTL is an integer within standard RFC bounds [30s, 604800s].
 */
export function validateTtl(ttl?: number): { valid: boolean; error?: string; value: number } {
  if (ttl === undefined || ttl === null) {
    return { valid: true, value: 300 }; // Default 5 minutes
  }
  if (typeof ttl !== 'number' || !Number.isInteger(ttl)) {
    return { valid: false, error: 'TTL must be an integer number of seconds.', value: 300 };
  }
  if (ttl < MIN_TTL_SECONDS) {
    return { valid: false, error: `TTL cannot be less than ${MIN_TTL_SECONDS} seconds.`, value: MIN_TTL_SECONDS };
  }
  if (ttl > MAX_TTL_SECONDS) {
    return { valid: false, error: `TTL cannot exceed ${MAX_TTL_SECONDS} seconds (7 days).`, value: MAX_TTL_SECONDS };
  }
  return { valid: true, value: ttl };
}

/**
 * Checks whether an IPv4 address belongs to a private/internal/reserved range
 * (RFC 1918, RFC 5735, RFC 1122).
 */
export function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return false;
  }
  const [b0, b1] = parts;
  if (b0 === 10) return true; // 10.0.0.0/8
  if (b0 === 127) return true; // 127.0.0.0/8 (Loopback)
  if (b0 === 172 && b1 >= 16 && b1 <= 31) return true; // 172.16.0.0/12
  if (b0 === 192 && b1 === 168) return true; // 192.168.0.0/16
  if (b0 === 169 && b1 === 254) return true; // 169.254.0.0/16 (Link-Local)
  if (b0 === 0 || b0 >= 224) return true; // Reserved, multicast, broadcast
  return false;
}

/**
 * Checks whether an IPv6 address belongs to a private/internal/reserved range
 * (RFC 4193 ULA, RFC 4291 Loopback/Link-Local).
 */
export function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase().trim();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // ULA
  if (
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  ) {
    return true; // Link-Local
  }
  return false;
}

/**
 * Validates external hosting connection destinations.
 * Enforces real destination requirements:
 * - A record: Valid IPv4 address; cannot be 0.0.0.0 or 255.255.255.255.
 * - AAAA record: Valid IPv6 address; cannot be ::.
 * - CNAME record: Valid external FQDN; cannot be an IP address; cannot loop to self.
 * - Explicitly tags whether the destination is a public routable or private address.
 */
export function validateHostingDestination(
  type: 'A' | 'AAAA' | 'CNAME',
  destination: string,
  sourceFqdn?: string
): {
  valid: boolean;
  error?: string;
  isPrivateAddress?: boolean;
  isPublicRoutable?: boolean;
} {
  if (!destination || typeof destination !== 'string') {
    return { valid: false, error: 'Hosting destination cannot be empty.' };
  }

  const trimmed = destination.trim();

  if (type === 'A') {
    const valCheck = validateRecordValue('A', trimmed);
    if (!valCheck.valid) {
      return { valid: false, error: valCheck.error || 'Invalid IPv4 address for hosting A record.' };
    }

    if (trimmed === '0.0.0.0') {
      return { valid: false, error: 'Destination cannot be 0.0.0.0. A real hosting provider IP is required.' };
    }
    if (trimmed === '255.255.255.255') {
      return { valid: false, error: 'Destination cannot be broadcast address 255.255.255.255.' };
    }

    const isPrivate = isPrivateIpv4(trimmed);
    return {
      valid: true,
      isPrivateAddress: isPrivate,
      isPublicRoutable: !isPrivate,
    };
  }

  if (type === 'AAAA') {
    const valCheck = validateRecordValue('AAAA', trimmed);
    if (!valCheck.valid) {
      return { valid: false, error: valCheck.error || 'Invalid IPv6 address for hosting AAAA record.' };
    }

    if (trimmed === '::') {
      return { valid: false, error: 'Destination cannot be unspecified IPv6 address ::. A real hosting IPv6 address is required.' };
    }

    const isPrivate = isPrivateIpv6(trimmed);
    return {
      valid: true,
      isPrivateAddress: isPrivate,
      isPublicRoutable: !isPrivate,
    };
  }

  if (type === 'CNAME') {
    const normalizedTarget = normalizeDomain(trimmed);

    // CNAME target cannot be an IP address
    const isIpv4 =
      /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(
        trimmed
      );
    if (isIpv4) {
      return {
        valid: false,
        error: `CNAME destination cannot be an IP address ('${trimmed}'). Use an 'A' record for IP destinations.`,
      };
    }

    const valCheck = validateRecordValue('CNAME', normalizedTarget);
    if (!valCheck.valid) {
      return { valid: false, error: valCheck.error || 'Invalid canonical hostname for CNAME record.' };
    }

    // Prevent direct circular self-referencing loop
    if (sourceFqdn) {
      const normalizedSource = normalizeDomain(sourceFqdn);
      if (normalizedTarget === normalizedSource) {
        return {
          valid: false,
          error: `Self-referencing loop: CNAME target cannot point to '${normalizedSource}' itself.`,
        };
      }
    }

    return { valid: true, isPublicRoutable: true, isPrivateAddress: false };
  }

  return { valid: false, error: `Unsupported hosting record type '${type}'. Only 'A', 'AAAA', and 'CNAME' are supported.` };
}
