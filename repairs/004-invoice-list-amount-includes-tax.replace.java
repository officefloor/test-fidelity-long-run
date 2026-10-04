            return new InvoiceView(invoice.getId(), invoice.getProjectId(),
                    InvoiceMoney.netTotal(invoice.getAmount(), invoice.getDiscountPct(),
                            invoice.getTaxPct()),
