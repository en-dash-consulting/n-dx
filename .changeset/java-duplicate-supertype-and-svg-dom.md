---
"@n-dx/lang-java": patch
---

The Java resolver keeps each declaration's own supertypes: when two modules declare the same class, an inherited member type is looked up only through the supertypes of the declaration in the referencing file, and of a supertype declared in several files only the ones that file sees give members or are followed. The SVG and SMIL DOM (`org.w3c.dom.svg`, `org.w3c.dom.smil`, shipped in xml-apis-ext and Batik) are named `java:` rather than `java:stdlib:`.
