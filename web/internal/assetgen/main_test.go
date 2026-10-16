package main

import "testing"

func TestStripLineComments(t *testing.T) {
	in := "// header\n(function () {\n\t// note\n\tvar url = \"https://example.com\"; // kept: code line\n\tvar re = /\\/\\//;\n})();\n"
	want := "(function () {\n\tvar url = \"https://example.com\"; // kept: code line\n\tvar re = /\\/\\//;\n})();\n"
	if got := string(stripLineComments([]byte(in))); got != want {
		t.Fatalf("got %q", got)
	}
}
