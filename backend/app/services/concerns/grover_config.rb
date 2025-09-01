# frozen_string_literal: true

module GroverConfig
  extend ActiveSupport::Concern

  private
    def puppeteer_launch_args
      [
        # Essential security
        "--no-sandbox",
        "--disable-setuid-sandbox",

        # Additional features to disable
        "--disable-extensions",
        "--disable-plugins",
        "--disable-component-update",
        "--disable-domain-reliability",
        "--disable-notifications",
        "--disable-offer-store-unmasked-wallet-cards",
        "--disable-print-preview",
        "--disable-speech-api",
        "--disable-web-security",
        "--disable-features=AudioServiceOutOfProcess,VizDisplayCompositor",

        # Print-specific optimizations
        "--run-all-compositor-stages-before-draw",
        "--disable-checker-imaging",
        "--disable-new-content-rendering-timeout",
        "--disable-threaded-animation",
        "--disable-threaded-scrolling",
        "--disable-partial-raster",

        # Media and rendering
        "--use-gl=swiftshader",
        "--disable-gpu-sandbox",

        # Memory and performance
        "--memory-pressure-off",
        "--max_old_space_size=4096",

        # Additional startup optimizations
        "--autoplay-policy=user-gesture-required",
        "--disable-site-isolation-trials",
        "--ignore-gpu-blacklist",
        "--no-default-browser-check",
        "--no-pings",
        "--no-zygote",
      ]
    end

    def default_grover_options
      {
        launch_args: puppeteer_launch_args,
        executable_path: ENV["PUPPETEER_EXECUTABLE_PATH"],
        print_background: true,
      }
    end
end
