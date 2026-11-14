/**
 * PHP's own classes and interfaces: the core's and those of the extensions
 * bundled with PHP, each group with the php.net manual book that lists it.
 * A reference to one is never an external package. PECL extensions
 * (Memcached, Imagick, Redis) are not PHP's own and are not listed: their
 * classes are outside dependencies like any other.
 *
 * Functions and constants need no list: PHP's own, every extension's and the
 * project's global ones all live in the global namespace, and an unqualified
 * function or constant falls back to it, so the resolver never makes an
 * external of a global function or constant.
 *
 * @module lang-php/php-builtins
 */

import type { RuleProvenance } from "@n-dx/lang-runtime";

/** Where the lists were checked: the manual's predefined classes, and each group's book (`https://www.php.net/manual/en/book.<name>.php`). */
export const PHP_BUILTINS_PROVENANCE: RuleProvenance = {
  verifiedAgainst: ["PHP manual"],
  verifiedOn: "2026-11-14",
  source: "https://www.php.net/manual/en/reserved.classes.php",
};

/** Global classes and interfaces, by manual book. */
const BUILTIN_CLASS_GROUPS: Readonly<Record<string, readonly string[]>> = {
  // reserved.classes.php, reserved.interfaces.php, class.error.php and its subclasses
  core: [
    "stdClass", "Closure", "Generator", "WeakReference", "WeakMap", "Fiber", "__PHP_Incomplete_Class", "Directory",
    "php_user_filter", "Attribute", "ReturnTypeWillChange", "AllowDynamicProperties", "SensitiveParameter",
    "SensitiveParameterValue", "Override", "Deprecated", "Traversable", "Iterator", "IteratorAggregate",
    "InternalIterator", "Throwable", "ArrayAccess", "Serializable", "Countable", "Stringable", "UnitEnum", "BackedEnum",
    "Exception", "ErrorException", "Error", "CompileError", "ParseError", "TypeError", "ArgumentCountError",
    "ValueError", "ArithmeticError", "DivisionByZeroError", "AssertionError", "UnhandledMatchError", "FiberError",
  ],
  spl: [
    "BadFunctionCallException", "BadMethodCallException", "DomainException", "InvalidArgumentException",
    "LengthException", "LogicException", "OutOfBoundsException", "OutOfRangeException", "OverflowException",
    "RangeException", "RuntimeException", "UnderflowException", "UnexpectedValueException", "SplDoublyLinkedList",
    "SplStack", "SplQueue", "SplHeap", "SplMaxHeap", "SplMinHeap", "SplPriorityQueue", "SplFixedArray",
    "SplObjectStorage", "ArrayObject", "ArrayIterator", "RecursiveArrayIterator", "AppendIterator", "CachingIterator",
    "CallbackFilterIterator", "DirectoryIterator", "EmptyIterator", "FilesystemIterator", "FilterIterator",
    "GlobIterator", "InfiniteIterator", "IteratorIterator", "LimitIterator", "MultipleIterator", "NoRewindIterator",
    "ParentIterator", "RecursiveCachingIterator", "RecursiveCallbackFilterIterator", "RecursiveDirectoryIterator",
    "RecursiveFilterIterator", "RecursiveIteratorIterator", "RecursiveRegexIterator", "RecursiveTreeIterator",
    "RegexIterator", "OuterIterator", "RecursiveIterator", "SeekableIterator", "SplObserver", "SplSubject",
    "SplFileInfo", "SplFileObject", "SplTempFileObject",
  ],
  datetime: [
    "DateTime", "DateTimeImmutable", "DateTimeInterface", "DateTimeZone", "DateInterval", "DatePeriod", "DateError",
    "DateObjectError", "DateRangeError", "DateException", "DateInvalidTimeZoneException",
    "DateInvalidOperationException", "DateMalformedStringException", "DateMalformedIntervalStringException",
    "DateMalformedPeriodStringException",
  ],
  json: ["JsonSerializable", "JsonException"],
  pdo: ["PDO", "PDOStatement", "PDOException", "PDORow"],
  mysqli: ["mysqli", "mysqli_result", "mysqli_stmt", "mysqli_driver", "mysqli_warning", "mysqli_sql_exception"],
  sqlite3: ["SQLite3", "SQLite3Stmt", "SQLite3Result", "SQLite3Exception"],
  dom: [
    "DOMDocument", "DOMElement", "DOMNode", "DOMNodeList", "DOMXPath", "DOMAttr", "DOMText", "DOMComment",
    "DOMCdataSection", "DOMDocumentFragment", "DOMDocumentType", "DOMEntity", "DOMEntityReference", "DOMException",
    "DOMImplementation", "DOMNamedNodeMap", "DOMNotation", "DOMProcessingInstruction", "DOMCharacterData",
    "DOMChildNode", "DOMParentNode", "DOMNameSpaceNode",
  ],
  simplexml: ["SimpleXMLElement", "SimpleXMLIterator"],
  xmlreader: ["XMLReader"],
  xmlwriter: ["XMLWriter"],
  xml: ["XMLParser"],
  xsl: ["XSLTProcessor"],
  libxml: ["LibXMLError"],
  reflection: [
    "Reflection", "Reflector", "ReflectionClass", "ReflectionObject", "ReflectionMethod", "ReflectionFunction",
    "ReflectionFunctionAbstract", "ReflectionParameter", "ReflectionProperty", "ReflectionClassConstant",
    "ReflectionType", "ReflectionNamedType", "ReflectionUnionType", "ReflectionIntersectionType", "ReflectionException",
    "ReflectionExtension", "ReflectionZendExtension", "ReflectionGenerator", "ReflectionEnum", "ReflectionEnumUnitCase",
    "ReflectionEnumBackedCase", "ReflectionAttribute", "ReflectionReference", "ReflectionFiber", "ReflectionConstant",
  ],
  intl: [
    "Collator", "NumberFormatter", "Locale", "Normalizer", "MessageFormatter", "IntlDateFormatter",
    "IntlDatePatternGenerator", "ResourceBundle", "Transliterator", "IntlTimeZone", "IntlCalendar",
    "IntlGregorianCalendar", "IntlBreakIterator", "IntlRuleBasedBreakIterator", "IntlCodePointBreakIterator",
    "IntlPartsIterator", "IntlIterator", "IntlChar", "IntlException", "Spoofchecker", "UConverter",
  ],
  zip: ["ZipArchive"],
  phar: ["Phar", "PharData", "PharFileInfo", "PharException"],
  soap: ["SoapClient", "SoapServer", "SoapFault", "SoapHeader", "SoapParam", "SoapVar"],
  curl: ["CURLFile", "CURLStringFile", "CurlHandle", "CurlMultiHandle", "CurlShareHandle"],
  fileinfo: ["finfo"],
  session: ["SessionHandler", "SessionHandlerInterface", "SessionIdInterface", "SessionUpdateTimestampHandlerInterface"],
  image: ["GdImage", "GdFont"],
  openssl: ["OpenSSLCertificate", "OpenSSLCertificateSigningRequest", "OpenSSLAsymmetricKey"],
  sockets: ["Socket", "AddressInfo"],
  hash: ["HashContext"],
  zlib: ["InflateContext", "DeflateContext"],
  gmp: ["GMP"],
  tidy: ["tidy", "tidyNode"],
  shmop: ["Shmop"],
  sem: ["SysvMessageQueue", "SysvSemaphore", "SysvSharedMemory"],
  ffi: ["FFI"],
};

/**
 * Namespaces PHP itself declares classes in (`Random\Randomizer`,
 * `Dom\HTMLDocument`, `Pdo\Mysql`, `PgSql\Connection`, `FTP\Connection`,
 * `LDAP\Connection`, `IMAP\Connection`, `PSpell\Dictionary`, `FFI\CData`,
 * `BcMath\Number`, `Odbc\Connection`, `Soap\Url`): a name under one is PHP's
 * own when the project does not declare it.
 */
const BUILTIN_NAMESPACES: readonly string[] = [
  "Random", "Dom", "Pdo", "PgSql", "FTP", "LDAP", "IMAP", "PSpell", "FFI", "BcMath", "Odbc", "Soap",
];

const CLASSES: ReadonlySet<string> = new Set(Object.values(BUILTIN_CLASS_GROUPS).flat().map((n) => n.toLowerCase()));
const NAMESPACES: ReadonlySet<string> = new Set(BUILTIN_NAMESPACES.map((n) => n.toLowerCase()));

/**
 * True when `name`, fully qualified without a leading `\`, is one of PHP's
 * own classes or interfaces. Class names are case-insensitive in PHP.
 */
export function isPhpBuiltinClass(name: string): boolean {
  const lower = name.toLowerCase();
  const sep = lower.indexOf("\\");
  return sep < 0 ? CLASSES.has(lower) : NAMESPACES.has(lower.slice(0, sep));
}
