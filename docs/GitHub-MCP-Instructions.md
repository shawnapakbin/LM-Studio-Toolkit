Build from source
You can use go build to build the binary in the
cmd/github-mcp-server directory, and use the github-mcp-server stdio command with the GITHUB_PERSONAL_ACCESS_TOKEN environment variable set to your token. To specify the output location of the build, use the -o flag. You should configure your server to use the built executable as its command. For example:

{
  "mcp": {
    "servers": {
      "github": {
        "command": "/path/to/github-mcp-server",
        "args": ["stdio"],
        "env": {
          "GITHUB_PERSONAL_ACCESS_TOKEN": "<YOUR_TOKEN>"
        }
      }
    }
  }
}
Tool Configuration
The GitHub MCP Server supports enabling or disabling specific groups of functionalities via the --toolsets flag. This allows you to control which GitHub API capabilities are available to your AI tools. Enabling only the toolsets that you need can help the LLM with tool choice and reduce the context size.

Toolsets are not limited to Tools. Relevant MCP Resources and Prompts are also included where applicable.

When no toolsets are specified, default toolsets are used.

Looking for examples? See the Server Configuration Guide for common recipes like minimal setups, read-only mode, and combining tools with toolsets.

Specifying Toolsets
To specify toolsets you want available to the LLM, you can pass an allow-list in two ways:

Using Command Line Argument:

github-mcp-server --toolsets repos,issues,pull_requests,actions,code_security
Using Environment Variable:

GITHUB_TOOLSETS="repos,issues,pull_requests,actions,code_security" ./github-mcp-server
The environment variable GITHUB_TOOLSETS takes precedence over the command line argument if both are provided.

Specifying Individual Tools
You can also configure specific tools using the --tools flag. Tools can be used independently or combined with toolsets for fine-grained control.

Using Command Line Argument:

github-mcp-server --tools get_file_contents,issue_read,create_pull_request
Using Environment Variable:

GITHUB_TOOLS="get_file_contents,issue_read,create_pull_request" ./github-mcp-server
Combining with Toolsets (additive):

github-mcp-server --toolsets repos,issues --tools get_gist
This registers all tools from repos and issues toolsets, plus get_gist.

Important Notes:

Tools and toolsets can be used together
Read-only mode takes priority: write tools are skipped if --read-only is set, even if explicitly requested via --tools
Tool names must match exactly (e.g., get_file_contents, not getFileContents). Invalid tool names will cause the server to fail at startup with an error message
When tools are renamed, old names are preserved as aliases for backward compatibility. See Tool Renaming for details.
Using Toolsets With Docker
When using Docker, you can pass the toolsets as environment variables:

docker run -i --rm \
  -e GITHUB_PERSONAL_ACCESS_TOKEN=<your-token> \
  -e GITHUB_TOOLSETS="repos,issues,pull_requests,actions,code_security" \
  ghcr.io/github/github-mcp-server
Using Tools With Docker
When using Docker, you can pass specific tools as environment variables. You can also combine tools with toolsets:

# Tools only
docker run -i --rm \
  -e GITHUB_PERSONAL_ACCESS_TOKEN=<your-token> \
  -e GITHUB_TOOLS="get_file_contents,issue_read,create_pull_request" \
  ghcr.io/github/github-mcp-server

# Tools combined with toolsets (additive)
docker run -i --rm \
  -e GITHUB_PERSONAL_ACCESS_TOKEN=<your-token> \
  -e GITHUB_TOOLSETS="repos,issues" \
  -e GITHUB_TOOLS="get_gist" \
  ghcr.io/github/github-mcp-server
Special toolsets
"all" toolset
The special toolset all can be provided to enable all available toolsets regardless of any other configuration:

./github-mcp-server --toolsets all
Or using the environment variable:

GITHUB_TOOLSETS="all" ./github-mcp-server
"default" toolset
The default toolset default is the configuration that gets passed to the server if no toolsets are specified.

The default configuration is:

context
repos
issues
pull_requests
users
To keep the default configuration and add additional toolsets:

GITHUB_TOOLSETS="default,stargazers" ./github-mcp-server
Insiders Mode
The local GitHub MCP Server offers an insiders version with early access to new features and experimental tools.

Using Command Line Argument:

./github-mcp-server --insiders
Using Environment Variable:

GITHUB_INSIDERS=true ./github-mcp-server
When using Docker:

docker run -i --rm \
  -e GITHUB_PERSONAL_ACCESS_TOKEN=<your-token> \
  -e GITHUB_INSIDERS=true \
  ghcr.io/github/github-mcp-server
Available Toolsets
The following sets of tools are available:

Toolset	Description
person	context	Strongly recommended: Tools that provide context about the current user and GitHub context you are operating in
workflow	actions	GitHub Actions workflows and CI/CD operations
code-square	code_quality	GitHub Code Quality related tools
codescan	code_security	Code security related tools, such as GitHub Code Scanning
copilot	copilot	Copilot related tools
copilot	copilot_issue_intents	Opt-in Copilot issue assignment tools that carry intent metadata (rationale, confidence, suggestion)
dependabot	dependabot	Dependabot tools
comment-discussion	discussions	GitHub Discussions related tools
logo-gist	gists	GitHub Gist related tools
git-branch	git	GitHub Git API related tools for low-level Git operations
law	governance	Repository governance tools for managing rulesets and custom properties at the repository, organization, and enterprise levels
issue-opened	issues	GitHub Issues related tools
tag	labels	GitHub Labels related tools
bell	notifications	GitHub Notifications related tools
organization	orgs	GitHub Organization related tools
project	projects	GitHub Projects related tools
git-pull-request	pull_requests	GitHub Pull Request related tools
repo	repos	GitHub Repository related tools
shield-lock	secret_protection	Secret protection related tools, such as GitHub Secret Scanning
shield	security_advisories	Security advisories related tools
star	stargazers	GitHub Stargazers related tools
people	users	GitHub User related tools
Additional Toolsets in Remote GitHub MCP Server
Toolset	Description
copilot	Copilot related tools (e.g. Copilot Coding Agent)
copilot_spaces	Copilot Spaces related tools
github_support_docs_search	Search docs to answer GitHub product and support questions
Tools
workflow Actions
code-square Code Quality
codescan Code Security
person Context
copilot Copilot
copilot Copilot Issue Intents
dependabot Dependabot
comment-discussion Discussions
logo-gist Gists
git-branch Git
law Governance
issue-opened Issues
tag Labels
bell Notifications
organization Organizations
project Projects
git-pull-request Pull Requests
repo Repositories
shield-lock Secret Protection
shield Security Advisories
star Stargazers
people Users
Additional Tools in Remote GitHub MCP Server
Copilot
Copilot Spaces
GitHub Support Docs Search
Read-Only Mode
To run the server in read-only mode, you can use the --read-only flag. This will only offer read-only tools, preventing any modifications to repositories, issues, pull requests, etc.

./github-mcp-server --read-only
When using Docker, you can pass the read-only mode as an environment variable:

docker run -i --rm \
  -e GITHUB_PERSONAL_ACCESS_TOKEN=<your-token> \
  -e GITHUB_READ_ONLY=1 \
  ghcr.io/github/github-mcp-server
Lockdown Mode
Lockdown mode limits the content that the server will surface from public repositories. When enabled, the server checks whether the author of each item has push access to the repository. Private repositories are unaffected, and collaborators keep full access to their own content.

Lockdown mode is a best-effort content filter intended to reduce the risk of prompt injection from untrusted repository content (issues, pull requests, comments, commits, etc.). It is not an authorization boundary: it does not change what the underlying GitHub credential can read or write, and content withheld from a filtered tool response may still be reachable through other tools or direct GitHub API access with the same credential.

As an intentional exception, content authored by a small set of trusted bot accounts (currently github-actions[bot] and copilot) is always treated as safe, regardless of push access. This avoids filtering routine automation output (e.g. CI-generated commits or comments) that would otherwise be withheld under lockdown mode.

./github-mcp-server --lockdown-mode
When running with Docker, set the corresponding environment variable:

docker run -i --rm \
  -e GITHUB_PERSONAL_ACCESS_TOKEN=<your-token> \
  -e GITHUB_LOCKDOWN_MODE=1 \
  ghcr.io/github/github-mcp-server
In HTTP mode, this flag (or GITHUB_LOCKDOWN_MODE) is an upper bound: the X-MCP-Lockdown request header can enable lockdown mode when the operator has not, but it cannot disable lockdown mode the operator has already enabled. See the Server Configuration Guide for details.

The behavior of lockdown mode depends on the tool invoked.

Following tools will return an error when the author lacks the push access:

issue_read:get
pull_request_read:get
pull_request_read:get_diff
pull_request_read:get_files
pull_request_read:get_commits
Following tools will filter out content from users lacking the push access:

issue_read:get_comments
issue_read:get_sub_issues
pull_request_read:get_comments
pull_request_read:get_review_comments
pull_request_read:get_reviews
i18n / Overriding Descriptions
The descriptions of the tools can be overridden by creating a
github-mcp-server-config.json file in the same directory as the binary.

The file should contain a JSON object with the tool names as keys and the new
descriptions as values. For example:

{
  "TOOL_ADD_ISSUE_COMMENT_DESCRIPTION": "an alternative description",
  "TOOL_CREATE_BRANCH_DESCRIPTION": "Create a new branch in a GitHub repository"
}
You can create an export of the current translations by running the binary with
the --export-translations flag.

This flag will preserve any translations/overrides you have made, while adding
any new translations that have been added to the binary since the last time you
exported.

./github-mcp-server --export-translations
cat github-mcp-server-config.json
You can also use ENV vars to override the descriptions. The environment
variable names are the same as the keys in the JSON file, prefixed with
GITHUB_MCP_ and all uppercase.

For example, to override the TOOL_ADD_ISSUE_COMMENT_DESCRIPTION tool, you can
set the following environment variable:

export GITHUB_MCP_TOOL_ADD_ISSUE_COMMENT_DESCRIPTION="an alternative description"
Overriding Server Name and Title
The same override mechanism can be used to customize the MCP server's name and
title fields in the initialization response. This is useful when running
multiple GitHub MCP Server instances (e.g., one for github.com and one for
GitHub Enterprise Server) so that agents can distinguish between them.

Key	Environment Variable	Default
SERVER_NAME	GITHUB_MCP_SERVER_NAME	github-mcp-server
SERVER_TITLE	GITHUB_MCP_SERVER_TITLE	GitHub MCP Server
For example, to configure a server instance for GitHub Enterprise Server:

{
  "SERVER_NAME": "ghes-mcp-server",
  "SERVER_TITLE": "GHES MCP Server"
}
Or using environment variables:

export GITHUB_MCP_SERVER_NAME="ghes-mcp-server"
export GITHUB_MCP_SERVER_TITLE="GHES MCP Server"
