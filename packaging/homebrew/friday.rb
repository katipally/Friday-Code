# Homebrew formula for Friday Code.
#
# Lives in a tap repo (e.g. github.com/katipally/homebrew-tap as Formula/friday.rb).
# `version` and the four `sha256` values are updated by the release workflow on each
# tagged release; `brew install katipally/tap/friday` then fetches the right binary.
class Friday < Formula
  desc "Terminal AI coding agent — animated TUI, multi-provider, tool-calling"
  homepage "https://github.com/katipally/friday-code"
  version "0.0.0-private" # rendered from the release tag at publish time
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/katipally/friday-code/releases/download/v#{version}/friday-darwin-arm64"
      sha256 "REPLACE_WITH_DARWIN_ARM64_SHA256"
    end
    on_intel do
      url "https://github.com/katipally/friday-code/releases/download/v#{version}/friday-darwin-x64"
      sha256 "REPLACE_WITH_DARWIN_X64_SHA256"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/katipally/friday-code/releases/download/v#{version}/friday-linux-arm64"
      sha256 "REPLACE_WITH_LINUX_ARM64_SHA256"
    end
    on_intel do
      url "https://github.com/katipally/friday-code/releases/download/v#{version}/friday-linux-x64"
      sha256 "REPLACE_WITH_LINUX_X64_SHA256"
    end
  end

  def install
    bin.install Dir["*"].first => "friday"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/friday --version")
  end
end
