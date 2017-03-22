

if lastNettingRequestHandId == lastHandNetted
	&& oracle.handId > lastHandNetted
		=> ProgressNettingRequest
 			-> leave

if lastNettingRequestTime + 10 min > now
	&& lastNettingRequestHandId > lastHandNetted
		=> HandleDispute
		
			if && receipts not submitted
    			-> submit receipts and distributions of all hands between
    				lastHandNetted + 1 to lastNettingRequestHandId

if lastNettingRequestTime + 10 min <= now
	&& lastNettingRequestHandId > lastHandNetted
		=> ProgressNetting
			-> call netting on contract