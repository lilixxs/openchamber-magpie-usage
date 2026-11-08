package provider

// A comment may look like a preset and must not be read as one:
// {ID: "ghost-comment", Icon: "ghost-comment"}
const VertexPreset = "google-vertex"

var presets = []PresetDef{
	// Strings may contain braces without changing the literal depth.
	{ID: "anthropic", Name: "Anthropic {not a field}", Icon: "claude-color", Kind: KindVendor,
		Note: "a } brace and a { brace live in this string",
		Regions: []Region{
			{ID: "global", Name: "Global", Chat: "https://api.anthropic.com"},
			{ID: "china", Name: "China", Chat: "https://api.anthropic.com.cn"},
		}},
	{ID: VertexPreset, Name: "Google Vertex AI", Icon: "vertexai-color", Kind: KindVendor,
		/* A block comment with a nested literal: {ID: "ghost-block", Icon: "ghost-block"} */
		Regions: []Region{{ID: "us", Name: "US"}, {ID: "eu", Name: "EU"}}},
	{ID: "typesafe", Name: "TypeSafe Jev", Icon: "typesafe", Kind: KindVendor},
}
