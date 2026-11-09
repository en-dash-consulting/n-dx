---
id: "75f5051d-faa4-4497-8de5-322d8f3a37f6"
type: "task"
title: "JDK packages outside java/javax/jdk (org.w3c.dom, org.xml.sax, com.sun.*, sun.*) are named java: instead of java:stdlib:"
slug: "jdk-packages-outside-java-javax-jdk"
description: "Found by ndx-adversarial-review of 79ea58ea (Java externals namespace). Verdict: should-fix (real, reachable, cheap, but outside the task's stated java/javax/jdk scope).\n\nScenario: a Java file with `import org.w3c.dom.Document;`, `import org.xml.sax.SAXException;`, `import com.sun.net.httpserver.HttpServer;` or `import sun.misc.Unsafe;` -> imports.json external `java:org.w3c.dom` etc. These packages are exported by JDK modules (java.xml, jdk.httpserver, jdk.unsupported, java.security.jgss: org.ietf.jgss, jdk.management: com.sun.management), so they belong under `java:stdlib:`.\n\nEvidence: packages/lang-java/src/java-resolver.ts isJdkPackage only checks java.*, jdk.*, javax.xml and JDK_JAVAX_PACKAGES.\nReachable: any Java repo with the pack, through sv analyze -> imports.json. org.w3c.dom / org.xml.sax are common in XML-handling code.\n\nWhy now: the pack is unreleased; changing these names after release is a breaking rename of external ids.\n\nOptions: (1, recommended) extend the JDK table with the non-javax roots exported by JDK 21 modules (org.w3c.dom, org.xml.sax, org.ietf.jgss, com.sun.net.httpserver, com.sun.management, com.sun.nio.sctp, com.sun.security.auth, com.sun.jdi, sun.misc, sun.reflect). Cost: a list and test lines. Risk: xml-apis also ships org.w3c.dom/org.xml.sax as a Maven artifact, but the JDK copy wins on the module path, so stdlib is the better name. (2) leave as java: and document that only java/javax/jdk are marked."
acceptanceCriteria:
  - "A resolver test importing org.w3c.dom.Document, org.xml.sax.SAXException, com.sun.net.httpserver.HttpServer and sun.misc.Unsafe expects java:stdlib:<package> for each"
  - "A non-JDK com.sun package (e.g. com.sun.mail from Jakarta Mail) stays java:<package>"
  - "The Java golden and the lang-java AGENTS.md note on namespaced externals agree with the new table"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "lang-java"
  - "review-fixes"
source: "ndx-adversarial-review"
---
