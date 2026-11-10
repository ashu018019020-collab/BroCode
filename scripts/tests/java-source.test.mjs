/**
 * Java single-file normalization.
 *
 * Judge0 compiles the submission as Main.java. These cases are the three authored shapes that used
 * to fail before compilation: a different public class, a package-private class with no Main, and a
 * bare statement snippet. The JDK still does the real work; this only makes the file valid.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareJavaSource, renameJavaIdentifier } from '../../shared/java-source.mjs';

test('java source: a Main program is untouched', () => {
  const code = 'public class Main { public static void main(String[] args) { System.out.println(1); } }';
  const prepared = prepareJavaSource(code);
  assert.equal(prepared.source, code);
  assert.equal(prepared.mode, 'program');
  assert.equal(prepared.changed, false);
});

test('java source: a public class named Student is renamed with its constructor and uses', () => {
  const code = `public class Student {
    Student(String name) { }
    public static void main(String[] args) {
        Student s = new Student("Aman");
        System.out.println("Student created");
    }
}`;
  const prepared = prepareJavaSource(code);
  assert.equal(prepared.mode, 'renamed');
  assert.match(prepared.source, /public class Main \{/);
  assert.match(prepared.source, /Main\(String name\)/);
  assert.match(prepared.source, /new Main\("Aman"\)/);
  assert.match(prepared.source, /"Student created"/, 'string literals keep their text');
  assert.doesNotMatch(prepared.source, /class Student/);
});

test('java source: a package-private class becomes Main so the runtime can find it', () => {
  const prepared = prepareJavaSource('class Demo { public static void main(String[] args) { System.out.println("ok"); } }');
  assert.equal(prepared.mode, 'renamed');
  assert.match(prepared.source, /class Main \{/);
});

test('java source: bare statements are wrapped in Main.main, imports first', () => {
  const prepared = prepareJavaSource(`import java.util.*;

List<String> names = new ArrayList<>();
names.add("Aman");
System.out.println(names.get(0));`);
  assert.equal(prepared.mode, 'wrapped');
  assert.match(prepared.source, /^import java\.util\.\*;/);
  assert.match(prepared.source, /public class Main \{/);
  assert.match(prepared.source, /public static void main\(String\[\] args\) \{/);
  assert.match(prepared.source, /names\.add\("Aman"\)/);
});

test('java source: comments, identifiers sharing a prefix and text blocks are not rewritten', () => {
  const source = `// Student is the old name
String StudentName = "Student";
String text = """
Student
""";
System.out.println(StudentName + text);`;
  const prepared = prepareJavaSource(source);
  assert.match(prepared.source, /\/\/ Student is the old name/);
  assert.match(prepared.source, /String StudentName = "Student";/);
  assert.match(prepared.source, /Student\s*\n\s*"""/);
});

test('java source: rename only touches code tokens', () => {
  const source = 'class Student { /* Student */ String s = "Student"; char c = \'S\'; }';
  const out = renameJavaIdentifier(source, 'Student', 'Main');
  assert.equal(out, 'class Main { /* Student */ String s = "Student"; char c = \'S\'; }');
});

test('java source: empty input is reported and nothing is wrapped', () => {
  const prepared = prepareJavaSource('   \n');
  assert.equal(prepared.mode, 'empty');
  assert.equal(prepared.changed, false);
});
