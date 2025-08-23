# frozen_string_literal: true

class CreatePdf
  include GroverConfig

  attr_reader :body_html, :recipient_country_code

  def initialize(body_html:, recipient_country_code: nil)
    @body_html = body_html
    @recipient_country_code = recipient_country_code
  end

  def perform
    html = ApplicationController.render template: "templates/pdf",
                                        locals: { body_html: },
                                        layout: false,
                                        formats: [:html]

    options = default_grover_options.merge(
      format: page_size,
      margin: { top: "2cm", left: "2cm", bottom: "2cm", right: "2cm" }
    )

    Grover.new(html, options).to_pdf
  end

  private
    def page_size
      recipient_country_code&.in?(%w[US CA]) ? "Legal" : "A4"
    end
end
