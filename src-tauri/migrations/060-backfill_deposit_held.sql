UPDATE tenants SET deposit_held = deposit_amount WHERE deposit_held = 0 AND deposit_amount IS NOT NULL;
